# Audio-to-Action

This project involves chaining different AI models together. You will build a backend pipeline that takes an audio recording of a meeting, transcribes it, and uses an LLM to extract the core decisions and assigned action items.
## Tools and Technologies Used
* Groq API - Whisper Large Model for Speech-to-Text, GPT OSS 12B for Summarizing
* Express.js
* React
## How to Make It
Build an Express endpoint that accepts a .mp3 or .wav file upload using a library like Multer.
* Send the audio buffer to the transcribing model, receiving a massive block of raw, unformatted transcribed text.
* Pass this entire transcript to the summarizing model, utilizing a prompt that demands a specific markdown format: "Meeting Summary," "Key Decisions," and a bulleted list of "Action Items" noting who is responsible for what.
* Return the perfectly formatted markdown string to the user so they can paste it directly into Slack or Notion.
