# Samara API Documentation

## Generate Track Endpoint

`POST /generate-track`

This endpoint generates a track using Sonauto AI or processes an uploaded track through Music AI for stem separation.

### URL Handling

The endpoint handles URLs differently based on the input source:

1. **Sonauto Generation**:
   - When a track is generated using Sonauto, the Sonauto CDN URL is passed directly to Music AI
   - Music AI downloads the track from Sonauto's CDN
   - The track is then stored in Firebase Storage after processing

2. **Direct File Upload**:
   - When a file is uploaded directly, it is first stored in Firebase Storage
   - The public Firebase Storage URL is passed to Music AI
   - Music AI downloads the track from Firebase Storage
   - Note: Currently using public URLs for simplicity. This will be improved with better security measures in future updates.

### Request Parameters

#### Option 1: Upload Track
- **Content-Type**: `multipart/form-data`
- **Parameter Name**: `track`
- **Type**: File
- **Supported Formats**: MP3, WAV, OGG
- **Max File Size**: 50MB

#### Option 2: Sonauto Generation
- **Content-Type**: `application/json`
- **Parameters**:
  ```json
  {
    "prompt": "string",         // Text prompt for track generation
    "duration": number,         // Duration in seconds (optional)
    "temperature": number,      // Randomness in generation (0-1, optional)
    "top_k": number,            // Number of top tokens to consider (optional)
    "top_p": number,            // Cumulative probability threshold (optional)
    "genre": "string",          // Genre specification (optional)
    "mood": "string",           // Mood specification (optional)
    "instrumentation": "string",    // Specific instruments to include (optional)
    "bpm": number,              // Beats per minute (optional)
    "key": "string",            // Musical key (optional)
    "scale": "string"           // Musical scale (optional)
  }
  ```

### Response - not complete but will not matter since these calls will be on ios client to external api directly

```json
{
  "trackId": "string",          // Unique identifier for the track
  "trackUrl": "string",         // URL of the original track
  "stems": {                    // URLs of separated stems
    "vocals": "string",
    "accompaniment": "string"
  },
  "message": "string",          // Success message
  "metadata": {
    "sonauto": {
      "taskId": "string",       // Sonauto generation task ID
      "generationStatus": "string" // Status of generation
    },
    "musicAi": {
      "jobId": "string",        // Music AI job ID
      "status": "string"        // Status of stem separation
    }
  }
}
```

### Firestore Document Structure

Each track is stored in the `tracks` collection with the following structure. The Firestore document serves as the real-time state of the track, reflecting any changes made during remixing. This structure will be optimized as we develop the remixing features.

```json
{
  "trackId": "uuid",             // Generated UUID for the track
  "isSaved": boolean,            // Has the track been saved and finished mixing
  "isPublished": URL             // Presigned URL of last published track
  "createdAt": "timestamp",      // Server timestamp
  "mixSettings": {               // Real-time mix settings that can be updated during remixing
    "volume": number,            // Overall volume level
    "reverb": number,            // Reverb effect level
    "eq": {                      // Equalizer settings
      "low": number,             // Low frequency adjustment
      "mid": number,             // Mid frequency adjustment
      "high": number             // High frequency adjustment
    },
    "duration": number,
    "genre": "string",
    "mood": "string",
    "instrumentation": "string",
    "bpm": number,            //Beats per minute
    "key": "string",          // Musical key
    "scale": "string"         // Musical scale
  }
}
```

Note: The Firestore document structure is designed to support real-time updates during the remixing process. 
Each time the user makes a change to the track being remixed, a new metadata object is created and saved in firestore. A background process will move old metadata to firebase and bring it back to firestore if needed. 

### Firebase Storage Structure

The following files are stored in Firebase Storage for each track:

```
tracks/
  ├── {trackId}/
  │   ├── original.mp3          // Original track file
  │   ├── stems/
  │   │   ├── vocals.mp3       // Separated vocals
  │   │   └── accompaniment.mp3 // Separated accompaniment
  │   ├── sonauto_response.json // Complete Sonauto API response
  │   ├── musicai_response.json // Complete Music AI API response
  │   ├── polls/
  │   │   ├── sonauto_polls.json // Sonauto polling history
  │   │   └── musicai_polls.json // Music AI polling history
  │   ├── saved/
  │   │   └── mix_{timestamp}.mp3 // Saved versions of the mix
  │   └── published/
  │       └── final_{timestamp}.mp3 // Published versions of the track
```

#### Storage JSON Examples

##### 1. Sonauto Response (sonauto_response.json)
```json
{
  "task_id": "string",
  "status": "SUCCESS",
  "song_paths": ["string"],
  "metadata": {
    "duration": number,
    "genre": "string",
    "mood": "string",
    "instrumentation": "string",
    "bpm": number,
    "key": "string",
    "scale": "string"
  },
  "created_at": "ISO-8601 timestamp",
  "updated_at": "ISO-8601 timestamp"
}
```

##### 2. Music AI Response (musicai_response.json)
```json
{
  "id": "string",
  "status": "SUCCEEDED",
  "workflow": "music-ai/stems-vocals-accompaniment",
  "result": {
    "vocals": "string",
    "accompaniment": "string",
    "duration": number,
    "sampleRate": number,
    "bitDepth": number
  },
  "created_at": "ISO-8601 timestamp",
  "completed_at": "ISO-8601 timestamp"
}
```

##### 3. Sonauto Polling History (polls/sonauto_polls.json)
```json
[
  {
    "timestamp": "2024-03-14T12:00:00.000Z",
    "status": {
      "task_id": "string",
      "status": "PENDING",
      "progress": 0.25,
      "metadata": {
        "duration": number,
        "genre": "string",
        "mood": "string",
        "instrumentation": "string",
        "bpm": number,
        "key": "string",
        "scale": "string"
      }
    }
  },
  {
    "timestamp": "2024-03-14T12:00:05.000Z",
    "status": {
      "task_id": "string",
      "status": "PROCESSING",
      "progress": 0.5,
      "metadata": {
        // ... same metadata structure
      }
    }
  },
  {
    "timestamp": "2024-03-14T12:00:10.000Z",
    "status": {
      "task_id": "string",
      "status": "SUCCESS",
      "song_paths": ["string"],
      "metadata": {
        // ... same metadata structure
      }
    }
  }
]
```

##### 4. Music AI Polling History (polls/musicai_polls.json)
```json
[
  {
    "timestamp": "2024-03-14T12:01:00.000Z",
    "status": {
      "id": "string",
      "status": "PENDING",
      "workflow": "music-ai/stems-vocals-accompaniment",
      "progress": 0.2
    }
  },
  {
    "timestamp": "2024-03-14T12:01:05.000Z",
    "status": {
      "id": "string",
      "status": "PROCESSING",
      "workflow": "music-ai/stems-vocals-accompaniment",
      "progress": 0.5
    }
  },
  {
    "timestamp": "2024-03-14T12:01:10.000Z",
    "status": {
      "id": "string",
      "status": "SUCCEEDED",
      "workflow": "music-ai/stems-vocals-accompaniment",
      "result": {
        "vocals": "string",
        "accompaniment": "string",
        "duration": number,
        "sampleRate": number,
        "bitDepth": number
      }
    }
  }
]
```

### Questions to Ask
Music.ai has different workflows. Do we want to give the users options to run jobs on different workflows?
Once the link is shared do we want to allow the track to still be edited?




### Example Usage

#### Upload Track
```bash
curl -X POST \
  http://localhost:3000/generate-track \
  -H 'Content-Type: multipart/form-data' \
  -F 'track=@/path/to/your/track.mp3'
```

#### Generate Track with Sonauto
```bash
curl -X POST \
  http://localhost:3000/generate-track \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "Upbeat electronic track with piano and drums",
    "duration": 180,
    "genre": "electronic",
    "mood": "upbeat",
    "instrumentation": "piano, drums, bass",
    "bpm": 128,
    "key": "C",
    "scale": "major"
  }'
```

### Error Responses -  need to update

```json
{
  "error": "string"  // Error message
}
```
