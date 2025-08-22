const EDGE_TTS_URL = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud';

let expiredAt = null;
let endpoint = null;
let clientId = "76a75279-2ffa-4c3d-8db8-7b47252aa41c";

export default {
  async fetch(request, env, ctx) {
    return await handleRequest(request, env, ctx);
  }
};

async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);

  if (url.pathname === '/api/check-password') return checkPassword(request);
  if (url.pathname === '/api/verify-password') return verifyPassword(request);
  if (url.pathname.startsWith('/api/tts'))
  {
    if (request.method === "POST") {
      const body = await request.json();
      const text = body.text || "";
      const voiceName = body.voice || "zh-CN-XiaoxiaoMultilingualNeural";
      const rate = Number(body.rate) || 0;
      const pitch = Number(body.pitch) || 0;
      const outputFormat = body.format || "audio-24khz-48kbitrate-mono-mp3";
      const download = body.preview === false;
      
      return await handleTTS(text, voiceName, rate, pitch, outputFormat, download);
    } else if (request.method === "GET") {
      const { query } = request;
      const text = query.t || "";
      const voiceName = query.v || "zh-CN-XiaoxiaoMultilingualNeural";
      const rate = Number(query.r) || 0;
      const pitch = Number(query.p) || 0;
      const outputFormat = query.o || "audio-24khz-48kbitrate-mono-mp3";
      const download = query.d === "true";
      
      return await handleTTS(text, voiceName, rate, pitch, outputFormat, download);
    }
  }
  if (url.pathname.startsWith('/api/voices')) return handleVoices(request, env);
  
  return serveStatic(request, url, env);
}

async function checkPassword(request) {
  return new Response(JSON.stringify({ requirePassword: false }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function verifyPassword(request) {
  const body = await request.json();
  const isValid = body.password === 'your_password_here';
  return new Response(JSON.stringify({ valid: isValid }), {
    status: isValid ? 200 : 401,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleTTS(text, voiceName, rate, pitch, outputFormat, download) {
  try {
    await refreshEndpoint();

    const ssml = generateSsml(text, voiceName, rate, pitch);
    const url = `https://${endpoint.r}.tts.speech.microsoft.com/cognitiveservices/v1`;

    const headers = {
      "Authorization": endpoint.t,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": outputFormat,
      "User-Agent": "okhttp/4.5.0",
      "Origin": "https://azure.microsoft.com",
      "Referer": "https://azure.microsoft.com/"
    };

    const ttsResponse = await fetch(url, {
      method: "POST",
      headers,
      body: ssml
    });

    if (!ttsResponse.ok) {
      throw new Error(`TTS 请求失败，状态码 ${ttsResponse.status}`);
    }

    const audioData = await ttsResponse.arrayBuffer();

    const responseHeaders = new Headers({
      "Content-Type": "audio/mpeg"
    });

    if (download) {
      responseHeaders.set("Content-Disposition", `attachment; filename="${voiceName}.mp3"`);
    }

    return new Response(audioData, {
      status: 200,
      headers: responseHeaders
    });
  } catch (error) {
    console.error("TTS Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}


function generateSsml(text, voiceName, rate, pitch) {
  return `<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" version="1.0" xml:lang="zh-CN"> 
              <voice name="${voiceName}"> 
                  <mstts:express-as style="general" styledegree="1.0" role="default"> 
                      <prosody rate="${rate}%" pitch="${pitch}%" volume="50">${text}</prosody> 
                  </mstts:express-as> 
              </voice> 
          </speak>`;
}

async function refreshEndpoint() {
  if (!expiredAt || Date.now() / 1000 > expiredAt - 60) {
    try {
      endpoint = await getEndpoint();
      
      // Parse JWT token to get expiry time
      const parts = endpoint.t.split(".");
      if (parts.length >= 2) {
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
          atob(base64)
            .split('')
            .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join('')
        );
        
        const decodedJwt = JSON.parse(jsonPayload);
        expiredAt = decodedJwt.exp;
      } else {
        // Default expiry if we can't parse the token
        expiredAt = (Date.now() / 1000) + 3600;
      }
      
      clientId = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).substring(2, 15);
      console.log(`获取 Endpoint, 过期时间剩余: ${((expiredAt - Date.now() / 1000) / 60).toFixed(2)} 分钟`);
    } catch (error) {
      console.error("无法获取或解析Endpoint:", error);
      throw error;
    }
  } else {
    console.log(`过期时间剩余: ${((expiredAt - Date.now() / 1000) / 60).toFixed(2)} 分钟`);
  }
}

async function getEndpoint() {
  const endpointUrl = "https://dev.microsofttranslator.com/apps/endpoint?api-version=1.0";
  const headers = {
    "Accept-Language": "zh-Hans",
    "X-ClientVersion": "4.0.530a 5fe1dc6c",
    "X-UserId": "0f04d16a175c411e",
    "X-HomeGeographicRegion": "zh-Hans-CN",
    "X-ClientTraceId": clientId || "76a75279-2ffa-4c3d-8db8-7b47252aa41c",
    "X-MT-Signature": await generateSignature(endpointUrl),
    "User-Agent": "okhttp/4.5.0",
    "Content-Type": "application/json; charset=utf-8",
    "Accept-Encoding": "gzip"
  };
  
  const response = await fetch(endpointUrl, {
    method: "POST",
    headers: headers
  });
  
  if (!response.ok) {
    throw new Error(`获取 Endpoint 失败，状态码 ${response.status}`);
  }
  
  return await response.json();
}

async function generateSignature(urlStr) {
  try {
    const url = urlStr.split("://")[1];
    const encodedUrl = encodeURIComponent(url);
    const uuidStr = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).substring(2, 15);
    const formattedDate = formatDate();
    const bytesToSign = `MSTranslatorAndroidApp${encodedUrl}${formattedDate}${uuidStr}`.toLowerCase();
    
    // Import the key for signing
    const keyData = base64ToArrayBuffer("oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw==");
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: { name: 'SHA-256' } },
      false,
      ['sign']
    );
    
    // Sign the data
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(bytesToSign)
    );
    
    // Convert the signature to base64
    const signatureBase64 = arrayBufferToBase64(signature);
    
    return `MSTranslatorAndroidApp::${signatureBase64}::${formattedDate}::${uuidStr}`;
  } catch (error) {
    console.error("Generate signature error:", error);
    throw error;
  }
}

function formatDate() {
  const date = new Date();
  const utcString = date.toUTCString().replace(/GMT/, "").trim() + " GMT";
  return utcString.toLowerCase();
}

// Helper functions
function base64ToArrayBuffer(base64) {
  const binary_string = atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function voiceList() {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "X-Ms-Useragent": "SpeechStudio/2021.05.001",
    "Content-Type": "application/json",
    "Origin": "https://azure.microsoft.com",
    "Referer": "https://azure.microsoft.com"
  };
  
  const response = await fetch("https://eastus.api.speech.microsoft.com/cognitiveservices/voices/list", {
    headers: headers
  });
  
  if (!response.ok) {
    throw new Error(`获取语音列表失败，状态码 ${response.status}`);
  }
  
  return await response.json();
}

async function handleVoices(request, env) {
  if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const speakersJson = await env.STATIC.get('speakers');
  const SPEAKERS = speakersJson ? JSON.parse(speakersJson) : {};

  const params = new URL(request.url).searchParams;
  const api = params.get('api') || 'edge-api';
  const f = params.get('f') === '1';
  const voices = SPEAKERS[api]?.speakers || {};
  const list = Object.entries(voices).map(([key, name]) => ({ key, name }));

  return new Response(f ? JSON.stringify(list) : list.map(v => `${v.key} / ${v.name}`).join('\n'), {
    headers: { 'Content-Type': f ? 'application/json' : 'text/plain' }
  });
}

async function serveStatic(request, url, env) {
  let value, contentType;

  switch (url.pathname) {
    case '/':
    case '/index.html':
      value = await env.STATIC.get('index');
      contentType = 'text/html; charset=utf-8';
      break;
    case '/style.css':
      value = await env.STATIC.get('style');
      contentType = 'text/css; charset=utf-8';
      break;
    case '/script.js':
      value = await env.STATIC.get('script');
      contentType = 'application/javascript; charset=utf-8';
      break;
    case '/speakers.json':
      value = await env.STATIC.get('speakers');
      contentType = 'application/json; charset=utf-8';
      break;
    default:
      return new Response('Not Found', { status: 404 });
  }

  return new Response(value || '', {
    headers: { 'Content-Type': contentType }
  });
}
