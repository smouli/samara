const express = require("express");
const cors = require("cors");
const axios = require("axios");
const admin = require("firebase-admin");
const multer = require("multer");
const dotenv = require("dotenv");
const { v4: uuidv4 } = require('uuid');

// Load environment variables
dotenv.config();

const FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET;
const SONAUTO_API_KEY = process.env.SONAUTO_API_KEY;
const MUSICAI_API_KEY = process.env.MUSICAI_API_KEY;

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  storageBucket: FIREBASE_STORAGE_BUCKET,
  projectId: process.env.FIREBASE_PROJECT_ID
});

const app = express();
app.use(cors());
app.use(express.json());
const db = admin.firestore();
const storage = admin.storage().bucket();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * ① Generate track from Sonauto OR accept uploaded track
 * ② Send to Music AI API for stem decomposition
 * ③ Store in Firebase Storage & update Firestore
 */
app.post("/generate-track", upload.single("track"), async (req, res) => {
    console.log("--------------------------------");
    console.log("Generating track...");
    try {
        let trackUrl;
        let fileName;

        // Check if the user uploaded a file
        if (req.file) {
            fileName = `uploads/${Date.now()}_${req.file.originalname}`;
            const file = storage.file(fileName);
            await file.save(req.file.buffer);
            trackUrl = `https://storage.googleapis.com/${storage.name}/${fileName}`;
        } else {
            // Otherwise, generate track using Sonauto API
            console.log("Generating track using Sonauto API...");
            const sonautoResponse = await axios.post(
                "https://api.sonauto.ai/v1/generations", 
                { prompt: "AI-generated track" },
                {
                    headers: {
                        'Authorization': `Bearer ${SONAUTO_API_KEY}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log("Sonauto Initial Response:", sonautoResponse.data);
            
            // Get the task_id from the response
            const taskId = sonautoResponse.data.task_id;
            console.log("Sonauto Task ID:", taskId);

            // Poll the generations endpoint until we get the track
            let trackData;
            let sonautoPolls = [];
            while (true) {
                console.log("Polling Sonauto generations for task:", taskId);
                const generationStatus = await axios.get(
                    `https://api.sonauto.ai/v1/generations/${taskId}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${SONAUTO_API_KEY}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );
                console.log("Sonauto Generation Status:", generationStatus.data);
                
                // Store each poll response
                sonautoPolls.push({
                    timestamp: new Date().toISOString(),
                    status: generationStatus.data
                });

                if (generationStatus.data.status === "SUCCESS") {
                    trackData = generationStatus.data;
                    break;
                } else if (generationStatus.data.status === "FAILURE") {
                    throw new Error("Sonauto generation failed");
                }
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s before retrying
            }

            // Get the track URL from the completed generation
            console.log("Track Data:", trackData);
            trackUrl = trackData.song_paths[0]; // Assuming we want the first track
            console.log("Final Sonauto Track URL:", trackUrl);
        }

        console.log("--------------------------------");
        console.log("Track URL:", trackUrl);
        console.log("SONAUTO_API_KEY:", SONAUTO_API_KEY);
        console.log("MUSICAI_API_KEY:", MUSICAI_API_KEY);
        console.log("--------------------------------");

        // ② Request stem decomposition from Music AI API
        const musicAiResponse = await axios.post(
            "https://api.music.ai/api/job", 
            {
                name: `Track_${uuidv4()}`,
                workflow: "music-ai/stems-vocals-accompaniment",
                params: {
                    inputUrl: trackUrl
                }
            },
            {
                headers: {
                    'Authorization': MUSICAI_API_KEY,
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log("Music AI Response:", musicAiResponse.data);
        const jobId = musicAiResponse.data.id;

        // ③ Poll Music AI API until job completes
        let stems;
        let musicAiPolls = [];
        while (true) {
            console.log("Polling job status for ID:", jobId);
            const jobStatus = await axios.get(
                `https://api.music.ai/api/job/${jobId}`,
                {
                    headers: {
                        'Authorization': MUSICAI_API_KEY,
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log("Job Status Response:", jobStatus.data);
            
            // Store each poll response
            musicAiPolls.push({
                timestamp: new Date().toISOString(),
                status: jobStatus.data
            });

            if (jobStatus.data.status === "SUCCEEDED") {
                stems = jobStatus.data.result;
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s before retrying
        }

        // ④ Store stems in Firebase Storage
        const stemUrls = {};
        for (const [stemType, url] of Object.entries(stems)) {
            const stemFileName = `stems/${Date.now()}_${stemType}.mp3`;
            const stemFile = storage.file(stemFileName);
            await axios.get(url, { responseType: "arraybuffer" }).then(res => stemFile.save(res.data));
            stemUrls[stemType] = `https://storage.googleapis.com/${storage.name}/${stemFileName}`;
        }

        // ⑤ Store complete responses in Firebase Storage
        const trackId = uuidv4();
        const storageRef = storage.file(`tracks/${trackId}`);
        
        // Store original track
        if (req.file) {
            await storageRef.save(req.file.buffer);
        } else {
            const trackResponse = await axios.get(trackUrl, { responseType: "arraybuffer" });
            await storageRef.save(trackResponse.data);
        }

        // Store complete API responses
        const sonautoResponseFile = storage.file(`tracks/${trackId}/sonauto_response.json`);
        await sonautoResponseFile.save(JSON.stringify(trackData));
        
        const musicAiResponseFile = storage.file(`tracks/${trackId}/musicai_response.json`);
        await musicAiResponseFile.save(JSON.stringify(jobStatus.data));

        // Store polling history
        const sonautoPollsFile = storage.file(`tracks/${trackId}/polls/sonauto_polls.json`);
        await sonautoPollsFile.save(JSON.stringify(sonautoPolls));
        
        const musicAiPollsFile = storage.file(`tracks/${trackId}/polls/musicai_polls.json`);
        await musicAiPollsFile.save(JSON.stringify(musicAiPolls));

        // ⑥ Write subset of data to Firestore
        await db.collection("tracks").doc(trackId).set({
            trackId,
            originalTrackUrl: `https://storage.googleapis.com/${storage.name}/tracks/${trackId}`,
            stems: stemUrls,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            mixSettings: {
                volume: 1.0,
                reverb: 0.5,
                eq: {
                    low: 0.2,
                    mid: 0.5,
                    high: 0.8
                }
            },
            sonauto: {
                taskId,
                generationStatus: trackData.status,
                prompt: "AI-generated track",
                songPaths: trackData.song_paths,
                metadata: {
                    duration: trackData.metadata?.duration,
                    genre: trackData.metadata?.genre,
                    mood: trackData.metadata?.mood,
                    instrumentation: trackData.metadata?.instrumentation,
                    bpm: trackData.metadata?.bpm,
                    key: trackData.metadata?.key,
                    scale: trackData.metadata?.scale
                }
            },
            musicAi: {
                jobId,
                status: jobStatus.data.status,
                workflow: "music-ai/stems-vocals-accompaniment",
                result: {
                    vocals: stems.vocals,
                    accompaniment: stems.accompaniment,
                    duration: jobStatus.data.result?.duration,
                    sampleRate: jobStatus.data.result?.sampleRate,
                    bitDepth: jobStatus.data.result?.bitDepth
                }
            }
        });

        // ⑦ Return comprehensive response
        res.json({
            trackId,
            trackUrl: `https://storage.googleapis.com/${storage.name}/tracks/${trackId}`,
            stems: stemUrls,
            message: "Track generated and stored successfully!",
            metadata: {
                sonauto: {
                    taskId,
                    generationStatus: trackData.status,
                    prompt: "AI-generated track",
                    songPaths: trackData.song_paths,
                    metadata: trackData.metadata
                },
                musicAi: {
                    jobId,
                    status: jobStatus.data.status,
                    workflow: "music-ai/stems-vocals-accompaniment",
                    result: jobStatus.data.result
                }
            },
            storage: {
                originalTrack: `https://storage.googleapis.com/${storage.name}/tracks/${trackId}`,
                stems: stemUrls,
                responses: {
                    sonauto: `https://storage.googleapis.com/${storage.name}/tracks/${trackId}/sonauto_response.json`,
                    musicAi: `https://storage.googleapis.com/${storage.name}/tracks/${trackId}/musicai_response.json`
                },
                polls: {
                    sonauto: `https://storage.googleapis.com/${storage.name}/tracks/${trackId}/polls/sonauto_polls.json`,
                    musicAi: `https://storage.googleapis.com/${storage.name}/tracks/${trackId}/polls/musicai_polls.json`
                }
            }
        });
    } catch (error) {
        console.error("Error in /generate-track:", error);
        res.status(500).json({ error: "Failed to generate track" });
    }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API Prototype running on port ${PORT}`));