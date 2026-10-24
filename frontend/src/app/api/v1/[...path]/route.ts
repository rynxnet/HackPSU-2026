import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL || "http://backend:8000";

async function proxy(request: NextRequest, { params }: { params: { path: string[] } }) {
  const subPath = params.path ? params.path.join("/") : "";
  const search = request.nextUrl.search || "";
  const targetUrl = `${BACKEND_URL}/api/v1/${subPath}${search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k !== "host" && k !== "content-length") {
      headers.set(k, value);
    }
  });

  let body: any = undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    try {
      body = await request.arrayBuffer();
    } catch {}
  }

  try {
    const backendRes = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
      // @ts-ignore
      duplex: "half",
      cache: "no-store",
    });

    const responseHeaders = new Headers();
    backendRes.headers.forEach((value, key) => {
      // fetch() already decoded the body, so these would no longer match it
      const k = key.toLowerCase();
      if (k !== "content-encoding" && k !== "content-length") {
        responseHeaders.set(key, value);
      }
    });

    return new NextResponse(backendRes.body, {
      status: backendRes.status,
      statusText: backendRes.statusText,
      headers: responseHeaders,
    });
  } catch (err: any) {
    console.error(`Error forwarding request to backend (${targetUrl}):`, err);
    return NextResponse.json(
      {
        detail: `Backend service is initializing or unreachable: ${err.message}. Please check if the backend container is running.`,
      },
      { status: 502 }
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
export const PATCH = proxy;
