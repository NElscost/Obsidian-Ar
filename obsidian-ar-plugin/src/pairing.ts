export interface PairingPayload {
  url: string;
  token: string;
  dynamicGraph: true;
}

export function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function createPairingUrl(
  viewerUrl: string,
  bridgeUrl: string,
  token: string
): string {
  const viewer = new URL(viewerUrl);
  if (viewer.protocol !== "https:") throw new Error(tr("O visualizador precisa usar HTTPS.", "The viewer must use HTTPS."));
  const bridge = new URL(bridgeUrl);
  if (bridge.protocol !== "https:") throw new Error(tr("A ponte precisa usar HTTPS.", "The bridge must use HTTPS."));
  const payload: PairingPayload = {
    url: bridge.origin,
    token,
    dynamicGraph: true
  };
  viewer.hash = `obsidian-ar=${base64UrlEncode(JSON.stringify(payload))}`;
  return viewer.toString();
}
import { tr } from "./i18n";
