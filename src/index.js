import company from '../data/company.json';

const GITHUB_ASSETS = 'https://raw.githubusercontent.com/caffeineworks/caffeineworks-mcp/main/assets';

// 접수번호 생성: EX-20260528-1423
function generateId(service) {
  const prefix = { exploration: 'EX', redesign: 'RD', reshoring: 'BR' };
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toTimeString().slice(0, 5).replace(':', '');
  return `${prefix[service] || 'XX'}-${date}-${time}`;
}

// 타임스탬프: YYYY-MM-DD HH:MM:SS
function getTimestamp() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').slice(0, 19);
}

// Google Sheets에 행 추가
async function appendToSheet(sheetId, values, env) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:append?valueInputOption=USER_ENTERED&key=${env.SHEETS_API_KEY}`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [values] }),
  });
}

// Google Sheets에서 접수번호로 피드백 조회
async function getFeedback(inquiryId, env) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.FEEDBACK_SHEET_ID}/values/A:E?key=${env.SHEETS_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  const rows = data.values || [];
  const row = rows.find(r => r[0] === inquiryId);
  if (!row) return null;
  return { id: row[0], timestamp: row[1], feedback: row[2], status: row[3], updated_at: row[4] };
}

// 서비스 문의 폼 HTML
function renderForm(serviceId) {
  const service = company.services.find(s => s.id === serviceId);
  if (!service) return '<p>서비스를 찾을 수 없습니다.</p>';

  const fields = {
    exploration: `
      <label>조사 대상 및 목적<textarea name="target" rows="3" required></textarea></label>
      <label>조사 범위
        <select name="scope">
          <option value="domestic">국내</option>
          <option value="overseas">해외</option>
          <option value="both">국내+해외</option>
        </select>
      </label>
      <label>납기 희망일<input type="date" name="deadline" required></label>`,

    redesign: `
      <label>컨설팅 영역
        <select name="area">
          <option value="ax">AX 혁신</option>
          <option value="development">개발체계 혁신</option>
          <option value="product">상품경쟁력 혁신</option>
        </select>
      </label>
      <label>현재 상황 및 핵심 문제<textarea name="issue" rows="4" required></textarea></label>
      <label>희망 착수 시점<input type="date" name="deadline" required></label>`,

    reshoring: `
      <label>대상
        <select name="target">
          <option value="executive">경영자</option>
          <option value="staff">실무자</option>
          <option value="teacher">교원</option>
        </select>
      </label>
      <label>참여 인원 (20명 이상)<input type="number" name="headcount" min="20" required></label>
      <label>희망 일정<input type="date" name="preferred_date" required></label>
      <label>희망 교육 장소<input type="text" name="location" placeholder="예: 서울 강남구 자사 회의실" required></label>`,
  };

  return `
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${service.name} 문의</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: sans-serif; background: #f5f5f5; display: flex; justify-content: center; padding: 40px 16px; }
  .card { background: #fff; border-radius: 12px; padding: 32px; max-width: 480px; width: 100%; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
  h2 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
  .desc { font-size: 13px; color: #666; margin-bottom: 24px; }
  label { display: flex; flex-direction: column; gap: 6px; font-size: 14px; font-weight: 500; margin-bottom: 16px; color: #333; }
  input, select, textarea { font-size: 14px; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; width: 100%; font-family: inherit; resize: vertical; }
  input:focus, select:focus, textarea:focus { outline: none; border-color: #1a6eb5; }
  .price { background: #f0f6ff; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #1a6eb5; margin-bottom: 20px; }
  button { width: 100%; padding: 12px; background: #1a6eb5; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; }
  button:hover { background: #145a96; }
  .result { display: none; text-align: center; padding: 24px 0; }
  .result h3 { font-size: 18px; margin-bottom: 8px; }
  .result .id { font-size: 22px; font-weight: 700; color: #1a6eb5; letter-spacing: 1px; margin: 12px 0; }
  .result p { font-size: 13px; color: #666; }
</style>
</head>
<body>
<div class="card">
  <h2>${service.name}</h2>
  <p class="desc">${service.description}</p>
  ${service.pricing ? `<div class="price">💰 ${service.pricing}${service.min_headcount ? ` · 최소 ${service.min_headcount}명` : ''}${service.duration ? ` · ${service.duration}` : ''}</div>` : ''}
  <form id="inquiry-form">
    ${fields[serviceId] || ''}
    <button type="submit">문의 접수</button>
  </form>
  <div class="result" id="result">
    <h3>접수가 완료되었습니다</h3>
    <div class="id" id="inquiry-id"></div>
    <p>위 접수번호를 메모해두세요.<br>검토 후 이메일(typica@caffeineworks.co)로 연락드립니다.</p>
  </div>
</div>
<script>
document.getElementById('inquiry-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = { service: '${serviceId}' };
  fd.forEach((v, k) => body[k] = v);
  const res = await fetch('/inquiry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  document.getElementById('inquiry-form').style.display = 'none';
  document.getElementById('inquiry-id').textContent = data.id;
  document.getElementById('result').style.display = 'block';
});
</script>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    // 회사 정보
    if (path === '/info') {
      return Response.json(company, { headers });
    }

    // 서비스 다이어그램 (.mmd 파일 반환)
    if (path === '/services/diagram') {
      const mmd = await fetch(`${GITHUB_ASSETS}/services.mmd`);
      const text = await mmd.text();
      return new Response(text, {
        headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    // 로고 URL 반환
    if (path === '/assets/logo') {
      const version = url.searchParams.get('v') || 'new';
      return Response.json({
        url: `${GITHUB_ASSETS}/logo_${version}.png`,
      }, { headers });
    }

    // 서비스 문의 폼 렌더링
    if (path.startsWith('/form/')) {
      const serviceId = path.replace('/form/', '');
      const html = renderForm(serviceId);
      return new Response(html, {
        headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // 문의 접수 처리
    if (path === '/inquiry' && request.method === 'POST') {
      const body = await request.json();
      const id = generateId(body.service);
      const timestamp = getTimestamp();

      // Inquiry 시트에 저장
      const row = [id, timestamp, body.service,
        body.target || '',
        body.scope || body.area || '',
        body.issue || '',
        body.deadline || body.preferred_date || '',
        body.headcount || '',
        body.preferred_date || '',
        body.location || '',
      ];
      await appendToSheet(env.INQUIRY_SHEET_ID, row, env);

      // Feedback 시트에 pending 행 생성
      await appendToSheet(env.FEEDBACK_SHEET_ID, [id, timestamp, '', 'pending', ''], env);

      return Response.json({ id, timestamp }, { headers });
    }

    // 피드백 조회
    if (path.startsWith('/feedback/')) {
      const inquiryId = path.replace('/feedback/', '');
      const feedback = await getFeedback(inquiryId, env);
      if (!feedback) {
        return Response.json({ error: '접수번호를 찾을 수 없습니다.' }, { status: 404, headers });
      }
      return Response.json(feedback, { headers });
    }

    return new Response('Not found', { status: 404, headers });
  },
};
