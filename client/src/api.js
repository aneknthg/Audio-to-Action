// Uses XMLHttpRequest (not fetch) so we can report real upload progress.
export function uploadAudio(file, { onProgress, onUploaded } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    // Upload finished; the server is now transcribing and summarizing.
    xhr.upload.onload = () => onUploaded && onUploaded();

    xhr.onload = () => {
      let body = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON response */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.error || `Request failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Could not reach the server. Is it running on port 3000?"));

    const form = new FormData();
    form.append("audio", file); // field name must match multer's upload.single("audio")
    xhr.send(form);
  });
}
