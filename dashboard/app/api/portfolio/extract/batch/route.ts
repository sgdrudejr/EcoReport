import { NextRequest } from "next/server";
import {
  batchResponseJsonSchema,
  buildBatchPrompt,
  extractTextFromGeminiResponse,
  fileToInlinePart,
  GEMINI_PORTFOLIO_MODEL,
  GEMINI_PORTFOLIO_URL,
  MAX_TOTAL_IMAGE_BYTES,
  normalizeBatchExtraction,
  parseGeminiJson,
} from "@/lib/portfolio-ocr";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return Response.json(
      { error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다." },
      { status: 500 },
    );
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return Response.json(
      { error: "잘못된 form-data 요청입니다." },
      { status: 400 },
    );
  }

  const files = formData
    .getAll("files")
    .filter((item): item is File => item instanceof File && item.size > 0);

  if (files.length === 0) {
    return Response.json(
      { error: "분류할 이미지가 없습니다. 먼저 캡처를 업로드하세요." },
      { status: 400 },
    );
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
    return Response.json(
      {
        error:
          "업로드한 이미지 용량이 너무 큽니다. 18MB 이하로 나눠서 다시 시도해 주세요.",
      },
      { status: 413 },
    );
  }

  try {
    const imageParts = [];
    for (const file of files) {
      imageParts.push({ text: `Screenshot filename: ${file.name}` });
      imageParts.push(await fileToInlinePart(file));
    }

    const response = await fetch(GEMINI_PORTFOLIO_URL, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              ...imageParts,
              {
                text: buildBatchPrompt(files.map((file) => file.name)),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseJsonSchema: batchResponseJsonSchema(),
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return Response.json(
        {
          error: `Gemini 호출 실패: ${response.status}`,
          detail,
        },
        { status: 502 },
      );
    }

    const payload = await response.json();
    const text = extractTextFromGeminiResponse(payload);
    if (!text) {
      return Response.json(
        { error: "Gemini가 비어 있는 응답을 반환했습니다." },
        { status: 502 },
      );
    }

    const extraction = normalizeBatchExtraction(parseGeminiJson(text));

    return Response.json({
      ok: true,
      model: GEMINI_PORTFOLIO_MODEL,
      screenshotCount: files.length,
      ...extraction,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "이미지 분류 중 알 수 없는 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}
