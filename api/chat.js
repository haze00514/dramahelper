export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: '서버에 GEMINI_API_KEY가 등록되지 않았습니다. Vercel 설정에서 환경변수를 확인해 주세요.'
    });
  }

  // 선택 사항: Vercel 환경변수에 CLASS_ACCESS_CODE를 설정한 경우 입장 코드 검사
  const requiredCode = (process.env.CLASS_ACCESS_CODE || '').trim();
  if (requiredCode) {
    const providedCode = String(req.headers['x-access-code'] || '').trim();
    if (providedCode !== requiredCode) {
      return res.status(403).json({
        error: '입장 코드가 맞지 않아요! 칠판에 적힌 우리 반 입장 코드를 다시 확인해 주세요.'
      });
    }
  }

  // 기본 모델 및 장애/지원종료 대비 자동 폴백 모델 목록
  const primaryModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
  const models = Array.from(new Set([
    primaryModel,
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash'
  ]));

  const payload = req.body;
  let lastStatus = 500;
  let lastErrorData = { error: 'AI 응답을 가져오지 못했습니다.' };

  for (const model of models) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    // 일시적 혼잡(429, 503) 시 최대 2회 짧은 재시도
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
          return res.status(200).json(data);
        }

        lastStatus = response.status;
        lastErrorData = data;

        // 404(모델명 불일치)면 다음 폴백 모델로 즉시 이동
        if (response.status === 404) {
          break;
        }

        // 429(요청 과다) 또는 503(일시 과부하)면 잠깐 대기 후 재시도
        if ((response.status === 429 || response.status === 503) && attempt === 0) {
          await new Promise((r) => setTimeout(r, 900 + Math.floor(Math.random() * 600)));
          continue;
        }

        break;
      } catch (err) {
        lastStatus = 500;
        lastErrorData = { error: '네트워크 연결 오류', detail: err.message };
      }
    }
  }

  return res.status(lastStatus).json(lastErrorData);
}
