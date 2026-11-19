/**
 * Shared square-cropped (256x256 JPEG) portrait uploader & compressor used by both
 * Player Onboarding Step 3 and Player Account Settings.
 */
export function compressPortraitFileToDataUrl(file: File, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const rawDataUrl = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(rawDataUrl);
          return;
        }
        const scale = Math.max(size / (img.width || size), size / (img.height || size));
        const dw = (img.width || size) * scale;
        const dh = (img.height || size) * scale;
        ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
        const compressed = canvas.toDataURL('image/jpeg', 0.86);
        if (compressed.length > 430000) {
          reject(new Error('Uploaded image is too large even after compression. Try a smaller image.'));
          return;
        }
        resolve(compressed);
      };
      img.onerror = () => reject(new Error('Selected file could not be decoded as an image.'));
      img.src = rawDataUrl;
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}
