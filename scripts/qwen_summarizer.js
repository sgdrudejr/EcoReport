
#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Configuration, OpenAIApi } from "openai";

// .env 파일 로드 (루트 디렉토리 기준)
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(fileURLToPath(import.meta.url), "../../.env") });

const QWEN_API_KEY = process.env.QWEN_API_KEY;
const QWEN_ENDPOINT = "https://dashscope.aliyuncs.com/api/v1"; // Qwen API 엔드포인트 예시

if (!QWEN_API_KEY) {
  console.error("❌ QWEN_API_KEY가 .env 파일에 설정되어 있지 않습니다.");
  process.exit(1);
}

// OpenAI 호환 API 설정을 위해 Configuration 객체 생성
const configuration = new Configuration({
  apiKey: QWEN_API_KEY,
  basePath: QWEN_ENDPOINT,
});

const openai = new OpenAIApi(configuration);

async function summarizeTextWithQwen(text) {
  try {
    const response = await openai.createChatCompletion({
      model: "qwen3.5-flash", // 사용자가 요청한 Qwen 모델 이름
      messages: [
        { role: "system", content: "너는 투자 리포트를 요약하는 전문 분석가야." },
        { role: "user", content: `다음 투자 리포트 내용을 요약해줘:\n\n${text}\n\n주요 내용, 핵심 키워드, 그리고 투자에 대한 시사점을 포함해서 JSON 형식으로 요약해줘.` },
      ],
      response_format: { type: "json_object" }, // JSON 형식 응답 요청
    });

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error("❌ Qwen API 호출 중 오류 발생:", error.response?.data || error.message);
    throw error;
  }
}

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    console.error(`❌ 파일 읽기 또는 파싱 오류 (${filePath}):`, error.message);
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const date = args[0] || new Date().toISOString().slice(0, 10);

  const extractsPath = path.join(process.cwd(), "data", "analysis-state", date, "stage1-report-extracts-v2.json");
  const extracts = await readJson(extractsPath);

  if (!extracts || !extracts.extracts || extracts.extracts.length === 0) {
    console.error(`❌ ${date} 날짜에 대한 리포트 추출 데이터를 찾을 수 없습니다: ${extractsPath}`);
    process.exit(1);
  }

  let combinedText = "";
  for (const extract of extracts.extracts) {
    combinedText += `제목: ${extract.title}\n`;
    combinedText += `요약: ${extract.summary || extract.main_summary || extract.investment_thesis}\n\n`;
  }

  console.log("총 요약 시작...");
  const totalSummary = await summarizeTextWithQwen(combinedText);
  console.log("✅ 총 요약 완료:", totalSummary);

  // 총 요약 결과를 저장할 경로
  const outputDirPath = path.join(process.cwd(), "data", "analysis-state", date);
  await fs.mkdir(outputDirPath, { recursive: true });
  const outputPath = path.join(outputDirPath, "qwen-total-summary.json");
  await fs.writeFile(outputPath, totalSummary, "utf8");
  console.log(`✅ 총 요약 결과가 ${outputPath}에 저장되었습니다.`);
}

main().catch((error) => {
  console.error("❌ 총 요약 실패:", error);
  process.exit(1);
});
