/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MODELS: R2Bucket;
  MODEL_UPLOAD_TOKEN: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/model-manifest.json") {
      const object = await env.MODELS.get("manifest.json");
      if (!object) {
        return Response.json(
          { url: "/Space.gltf", version: "bundled" },
          { headers: { "Cache-Control": "no-store" } }
        );
      }
      const manifest = await object.json<{ url?: string; graphUrl?: string; version?: string }>();
      const modelKey = manifest.url?.match(/^\/models\/(Space-[a-f0-9]{12}\.gltf)$/)?.[1];
      if (!modelKey || !(await env.MODELS.get(modelKey))) {
        return Response.json(
          { url: "/Space.gltf", graphUrl: "/graph.json", version: "bundled" },
          { headers: { "Cache-Control": "no-store" } }
        );
      }
      return Response.json(manifest, { headers: { "Cache-Control": "no-store" } });
    }

    if (request.method === "GET" && url.pathname.startsWith("/models/")) {
      const key = url.pathname.slice("/models/".length);
      if (!/^(?:Space-[a-f0-9]{12}\.(?:gltf|bin)|Graph-[a-f0-9]{12}\.json)$/.test(key)) {
        return new Response("Invalid model name", { status: 400 });
      }
      const object = await env.MODELS.get(key);
      if (!object) return new Response("Model not found", { status: 404 });
      return new Response(object.body, {
        headers: {
          "Content-Type": key.endsWith(".gltf")
            ? "model/gltf+json"
            : key.endsWith(".json")
              ? "application/json; charset=utf-8"
              : "application/octet-stream",
          "Cache-Control": "public, max-age=31536000, immutable",
          "ETag": object.httpEtag
        }
      });
    }

    if (request.method === "PUT" && url.pathname.startsWith("/api/models/")) {
      const authorization = request.headers.get("Authorization");
      if (
        !env.MODEL_UPLOAD_TOKEN ||
        authorization !== `Bearer ${env.MODEL_UPLOAD_TOKEN}`
      ) {
        return new Response("Unauthorized", { status: 401 });
      }

      const key = url.pathname.slice("/api/models/".length);
      if (!/^(?:Space-[a-f0-9]{12}\.(?:gltf|bin)|Graph-[a-f0-9]{12}\.json)$/.test(key)) {
        return new Response("Invalid model name", { status: 400 });
      }
      const contentLength = Number(request.headers.get("Content-Length") ?? 0);
      if (contentLength > 32 * 1024 * 1024) {
        return new Response("Model exceeds 32 MB", { status: 413 });
      }

      await env.MODELS.put(key, request.body, {
        httpMetadata: {
          contentType: key.endsWith(".gltf")
            ? "model/gltf+json"
            : key.endsWith(".json")
              ? "application/json"
              : "application/octet-stream"
        }
      });
      return Response.json({ uploaded: key });
    }

    if (request.method === "PUT" && url.pathname === "/api/model-manifest") {
      const authorization = request.headers.get("Authorization");
      if (
        !env.MODEL_UPLOAD_TOKEN ||
        authorization !== `Bearer ${env.MODEL_UPLOAD_TOKEN}`
      ) {
        return new Response("Unauthorized", { status: 401 });
      }

      const manifest = await request.json<{
        url?: string;
        graphUrl?: string;
        version?: string;
        updatedAt?: string;
      }>();
      if (
        !manifest.url ||
        !manifest.graphUrl ||
        !/^\/models\/Space-[a-f0-9]{12}\.gltf$/.test(manifest.url) ||
        !/^\/models\/Graph-[a-f0-9]{12}\.json$/.test(manifest.graphUrl)
      ) {
        return new Response("Invalid manifest", { status: 400 });
      }
      await env.MODELS.put("manifest.json", JSON.stringify(manifest), {
        httpMetadata: { contentType: "application/json" }
      });
      return Response.json({ active: manifest.version });
    }

    if (url.pathname === "/") {
      return Response.redirect(new URL("/xr.html", url), 302);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const response = await handler.fetch(request, env, ctx);
    if (url.pathname === "/Space.gltf" || url.pathname === "/Space.bin") {
      const cached = new Response(response.body, response);
      cached.headers.set(
        "Cache-Control",
        "public, max-age=86400, stale-while-revalidate=604800"
      );
      return cached;
    }
    return response;
  },
};

export default worker;
