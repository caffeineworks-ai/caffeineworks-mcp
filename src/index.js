import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import company from '../data/company.json';

const GITHUB_ASSETS = 'https://raw.githubusercontent.com/caffeineworks/caffeineworks-mcp/main/assets';

function generateId(service) {
  const prefix = { exploration: 'EX', redesign: 'RD', reshoring: 'BR' };
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toTimeString().slice(0, 5).replace(':', '');
  return `${prefix[service] || 'XX'}-${date}-${time}`;
}

function getTimestamp() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').slice(0, 19);
}

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: env.GOOGLE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  };
  const encode = obj => btoa(JSON.stringify(obj)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const pemBody = env.GOOGLE_PRIVATE_KEY
    .replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\n/g, '');
  const keyBytes = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', keyBytes.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const jwt = `${signingInput}.${sigB64}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  return (await res.json()).access_token;
}

async function appendToSheet(sheetId, values, env) {
  const token = await getAccessToken(env);
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:append?valueInputOption=USER_ENTERED`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ values: [values] }),
  });
}

async function getFeedback(inquiryId, env) {
  const token = await getAccessToken(env);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.FEEDBACK_SHEET_ID}/values/A:E`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json();
  const rows = data.values || [];
  const row = rows.find(r => r[0] === inquiryId);
  if (!row) return null;
  return { id: row[0], timestamp: row[1], feedback: row[2], status: row[3], updated_at: row[4] };
}

function createMcpServer(env) {
  const server = new McpServer({ name: "caffeineworks", version: "1.0.0" });

  server.tool("get_company_info", "카페인웍스 회사 소개 및 서비스 목록", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify(company, null, 2) }],
  }));

  server.tool("get_service_diagram", "서비스 체계 Mermaid 다이어그램 반환", {}, async () => {
    const res = await fetch(`${GITHUB_ASSETS}/services.mmd`);
    const text = await res.text();
    return { content: [{ type: "text", text }] };
  });

  server.tool("get_logo_url", "로고 이미지 URL 반환", {
    version: z.enum(["new", "old"]).default("new").describe("로고 버전"),
  }, async ({ version }) => ({
    content: [{ type: "text", text: `${GITHUB_ASSETS}/logo_${version}.png` }],
  }));

  server.tool("submit_inquiry", "서비스 문의 접수 및 접수번호 발급", {
    service: z.enum(["exploration", "redesign", "reshoring"]),
    target: z.string().optional(),
    scope: z.string().optional(),
    area: z.string().optional(),
    issue: z.string().optional(),
    deadline: z.string().optional(),
    headcount: z.number().optional(),
    preferred_date: z.string().optional(),
    location: z.string().optional(),
  }, async (params) => {
    const id = generateId(params.service);
    const timestamp = getTimestamp();
    const row = [id, timestamp, params.service,
      params.target || '', params.scope || params.area || '',
      params.issue || '', params.deadline || params.preferred_date || '',
      params.headcount || '', params.preferred_date || '', params.location || '',
    ];
    await appendToSheet(env.INQUIRY_SHEET_ID, row, env);
    await appendToSheet(env.FEEDBACK_SHEET_ID, [id, timestamp, '', 'pending', ''], env);
    return { content: [{ type: "text", text: `접수 완료\n접수번호: ${id}\n접수일시: ${timestamp}` }] };
  });

  server.tool("get_feedback", "접수번호로 검토 결과 조회", {
    inquiry_id: z.string().describe("접수번호 (예: BR-20260528-1423)"),
  }, async ({ inquiry_id }) => {
    const feedback = await getFeedback(inquiry_id, env);
    if (!feedback) return { content: [{ type: "text", text: "접수번호를 찾을 수 없습니다." }] };
    return { content: [{ type: "text", text: JSON.stringify(feedback, null, 2) }] };
  });

  return server;
}

function renderForm(serviceId) {
  const service = company.services.find(s => s.id === serviceId);
  if (!service) return '<p>서비스를 찾을 수 없습니다.</p>';
  const fields = {
    exploration: `<label>조사 대상 및 목적<textarea name="target" rows="3" required></textarea></label>
      <label>조사 범위<select name="scope"><option value="domestic">국내</option><option value="overseas">해외</option><option value="both">국내+해외</option></select></label>
      <label>납기 희망일<input type="date" name="deadline" required></label>`,
    redesign: `<label>컨설팅 영역<select name="area"><option value="ax">AX 혁신</option><option value="development">개발체계 혁신</option><option value="product">상품경쟁력 혁신</option></select></label>
      <label>현재 상황 및 핵심 문제<textarea name="issue" rows="4" required></textarea></label>
      <label>희망 착수 시점<input type="date" name="deadline" required></label>`,
    reshoring: `<label>대상<select name="target"><option value="executive">경영자</option><option value="staff">실무자</option><option value="teacher">교원</option></select></label>
      <label>참여 인원 (20명 이상)<input type="number" name="headcount" min="20" required></label>
      <label>희망 일정<input type="date" name="preferred_date" required></label>
      <label>희망 교육 장소<input type="text" name="location" required></label>`,
  };
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${service.name} 문의</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:sans-serif;background:#f5f5f5;display:flex;justify-content:center;padding:40px 16px}.card{background:#fff;border-radius:12px;padding:32px;max-width:480px;width:100%;box-shadow:0 2px 12px rgba(0,0,0,.08)}h2{font-size:20px;font-weight:600;margin-bottom:4px}.desc{font-size:13px;color:#666;margin-bottom:24px}label{display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:500;margin-bottom:16px;color:#333}input,select,textarea{font-size:14px;padding:10px 12px;border:1px solid #ddd;border-radius:8px;width:100%;font-family:inherit;resize:vertical}.price{background:#f0f6ff;border-radius:8px;padding:12px 16px;font-size:13px;color:#1a6eb5;margin-bottom:20px}button{width:100%;padding:12px;background:#1a6eb5;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}.result{display:none;text-align:center;padding:24px 0}.result .id{font-size:22px;font-weight:700;color:#1a6eb5;letter-spacing:1px;margin:12px 0}</style>
</head><body><div class="card"><h2>${service.name}</h2><p class="desc">${service.description}</p>
${service.pricing ? `<div class="price">💰 ${service.pricing}${service.min_headcount?` · 최소 ${service.min_headcount}명`:''}${service.duration?` · ${service.duration}`:''}</div>` : ''}
<form id="f">${fields[serviceId]||''}<button type="submit">문의 접수</button></form>
<div class="result" id="r"><h3>접수 완료</h3><div class="id" id="rid"></div><p>위 번호를 메모해두세요.<br>검토 후 typica@caffeineworks.co로 연락드립니다.</p></div></div>
<script>document.getElementById('f').addEventListener('submit',async(e)=>{e.preventDefault();const fd=new FormData(e.target);const body={service:'${serviceId}'};fd.forEach((v,k)=>body[k]=v);const res=await fetch('/inquiry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await res.json();document.getElementById('f').style.display='none';document.getElementById('rid').textContent=data.id;document.getElementById('r').style.display='block';});</script>
</body></html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    if (path === '/mcp') {
      const server = createMcpServer(env);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
      return new Response(response.body, { status: response.status, headers: newHeaders });
    }

    if (path.startsWith('/form/')) {
      const serviceId = path.replace('/form/', '');
      return new Response(renderForm(serviceId), {
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (path === '/inquiry' && request.method === 'POST') {
      const body = await request.json();
      const id = generateId(body.service);
      const timestamp = getTimestamp();
      const row = [id, timestamp, body.service, body.target||'', body.scope||body.area||'', body.issue||'', body.deadline||body.preferred_date||'', body.headcount||'', body.preferred_date||'', body.location||''];
      await appendToSheet(env.INQUIRY_SHEET_ID, row, env);
      await appendToSheet(env.FEEDBACK_SHEET_ID, [id, timestamp, '', 'pending', ''], env);
      return Response.json({ id, timestamp }, { headers: corsHeaders });
    }

    return new Response('Not found', { status: 404, headers: corsHeaders });
  },
};
