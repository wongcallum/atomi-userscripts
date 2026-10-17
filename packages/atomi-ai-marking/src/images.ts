import { GM_xmlhttpRequest } from "$";

const MAX_IMAGES = 10;
const MODEL_IMAGE = /^data:image\/(png|jpeg|webp|gif)[;,]/i;

export interface LoadedImage {
  /** as in [Image N] */
  n: number;
  /** data URL */
  url: string;
}

// Through the userscript manager, since Atomi's image host may not allow CORS
function fetchBlob(url: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: "GET",
      url,
      responseType: "blob",
      timeout: 20000,
      onload: (r) =>
        r.status >= 200 && r.status < 300 && r.response ? resolve(r.response) : reject(new Error(`HTTP ${r.status}`)),
      onerror: () => reject(new Error("network error")),
      ontimeout: () => reject(new Error("timed out")),
    });
  });
}

const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

// As a data URL in a format models accept, converting others (e.g. SVG) to PNG
async function imageToDataUrl(url: string): Promise<string> {
  if (MODEL_IMAGE.test(url)) return url;
  const dataUrl = url.startsWith("data:") ? url : await readAsDataUrl(await fetchBlob(url));
  if (MODEL_IMAGE.test(dataUrl)) return dataUrl;
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || 1024;
  canvas.height = img.naturalHeight || 768;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export async function loadImages(urls: string[]): Promise<LoadedImage[]> {
  const loaded = await Promise.all(
    urls.slice(0, MAX_IMAGES).map(async (url, i) => {
      try {
        return { n: i + 1, url: await imageToDataUrl(url) };
      } catch (err) {
        console.warn("[Atomi AI marking] Skipping image", url, err);
        return null;
      }
    }),
  );
  return loaded.filter((image) => image !== null);
}
