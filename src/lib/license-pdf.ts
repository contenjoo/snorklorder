// 동적 import로 jspdf + html2canvas 로드 (번들 크기 최적화)

interface GeneratePDFOptions {
  element: HTMLElement;
  filename: string;
  scale?: number; // 캡처 해상도 배율 (기본값: 2)
  imageType?: 'JPEG' | 'PNG'; // 임베드 이미지 포맷 (기본값: JPEG — 용량 대폭 절감)
  quality?: number; // JPEG 품질 0~1 (기본값: 0.85)
  maxSizeMB?: number; // 결과 PDF 최대 용량(MB). 초과 시 품질을 자동으로 낮춰 재시도 (기본값: 5)
  download?: boolean; // false면 저장하지 않고 용량 정보만 반환 (측정/검증용, 기본값: true)
}

interface CanvasRange {
  top: number;
  bottom: number;
}

interface CanvasPagination {
  avoidBreakRanges: CanvasRange[];
  repeatHeader?: CanvasRange;
  repeatHeaderUntil?: number;
}

export interface CanvasPageSlice {
  sourceTop: number;
  sourceHeight: number;
  outputHeight: number;
  repeatedHeader?: CanvasRange;
}

export interface GeneratePDFResult {
  sizeBytes: number;
  pages: number;
  quality: number;
  /** 저장하지 않고 파일을 직접 다루려는 호출자를 위한 PDF 본문(ZIP 묶기 등). */
  blob: Blob;
}

// A4 인쇄 영역 (mm)
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const MARGIN_MM = 5;
const PRINTABLE_WIDTH_MM = A4_WIDTH_MM - MARGIN_MM * 2; // 200mm
const PRINTABLE_HEIGHT_MM = A4_HEIGHT_MM - MARGIN_MM * 2; // 287mm

function findSafePageEnd(
  sourceTop: number,
  desiredEnd: number,
  ranges: CanvasRange[],
): number {
  const intersectedRange = ranges.find((range) => (
    range.top < desiredEnd
    && range.bottom > desiredEnd
    && range.top > sourceTop
  ));

  return intersectedRange?.top ?? desiredEnd;
}

/**
 * 캔버스 페이지를 표 행 경계에서 나누고, 다음 장이 같은 표에서 시작하면 헤더를 반복한다.
 * 한 행이 페이지보다 큰 경우에는 진행이 멈추지 않도록 기본 페이지 높이로 분할한다.
 */
export function planCanvasPageSlices(
  canvasHeight: number,
  pageHeight: number,
  pagination?: CanvasPagination,
): CanvasPageSlice[] {
  if (canvasHeight <= 0 || pageHeight <= 0) return [];

  const slices: CanvasPageSlice[] = [];
  let sourceTop = 0;

  while (sourceTop < canvasHeight) {
    const canRepeatHeader = Boolean(
      slices.length > 0
      && pagination?.repeatHeader
      && sourceTop >= pagination.repeatHeader.bottom
      && sourceTop < (pagination.repeatHeaderUntil ?? 0)
    );
    const repeatedHeader = canRepeatHeader ? pagination?.repeatHeader : undefined;
    const headerHeight = repeatedHeader
      ? Math.max(0, repeatedHeader.bottom - repeatedHeader.top)
      : 0;
    const contentCapacity = Math.max(1, pageHeight - headerHeight);
    const desiredEnd = Math.min(canvasHeight, sourceTop + contentCapacity);
    const safeEnd = findSafePageEnd(
      sourceTop,
      desiredEnd,
      pagination?.avoidBreakRanges ?? [],
    );
    const sourceEnd = safeEnd > sourceTop ? safeEnd : desiredEnd;
    const sourceHeight = sourceEnd - sourceTop;

    slices.push({
      sourceTop,
      sourceHeight,
      outputHeight: headerHeight + sourceHeight,
      ...(repeatedHeader ? { repeatedHeader } : {}),
    });
    sourceTop = sourceEnd;
  }

  return slices;
}

function readCanvasPagination(
  root: HTMLElement,
  canvas: HTMLCanvasElement,
): CanvasPagination | undefined {
  const table = root.querySelector<HTMLElement>('[data-pdf-paginated-table]');
  const header = table?.querySelector<HTMLElement>('thead');
  if (!table || !header) return undefined;

  const rootRect = root.getBoundingClientRect();
  if (rootRect.width <= 0) return undefined;
  // html2canvas는 가로 배율을 기준으로 같은 비율의 캔버스를 만든다.
  const yScale = canvas.width / rootRect.width;
  const toCanvasRange = (element: Element): CanvasRange => {
    const rect = element.getBoundingClientRect();
    return {
      top: Math.max(0, Math.round((rect.top - rootRect.top) * yScale)),
      bottom: Math.min(canvas.height, Math.round((rect.bottom - rootRect.top) * yScale)),
    };
  };

  return {
    avoidBreakRanges: Array.from(table.querySelectorAll('tr'))
      .map(toCanvasRange)
      .filter((range) => range.bottom > range.top),
    repeatHeader: toCanvasRange(header),
    repeatHeaderUntil: toCanvasRange(table).bottom,
  };
}

/**
 * 길게 캡처된 캔버스를 A4 인쇄 영역 단위로 잘라 각 페이지에 이미지로 추가한다.
 * (이미지를 페이지마다 통째로 중복 삽입하지 않고, 페이지 높이만큼 잘라 넣어 용량을 줄인다.)
 */
function addCanvasAsPages(
  pdf: import('jspdf').jsPDF,
  canvas: HTMLCanvasElement,
  imageType: 'JPEG' | 'PNG',
  quality: number,
  pagination?: CanvasPagination,
): number {
  const pxPerMm = canvas.width / PRINTABLE_WIDTH_MM;
  const pageHeightPx = Math.floor(PRINTABLE_HEIGHT_MM * pxPerMm);

  const mime = imageType === 'PNG' ? 'image/png' : 'image/jpeg';
  const pageSlices = planCanvasPageSlices(canvas.height, pageHeightPx, pagination);

  pageSlices.forEach((slice, pageIndex) => {

    // 현재 페이지 분량만 임시 캔버스에 그린다
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = canvas.width;
    pageCanvas.height = slice.outputHeight;
    const ctx = pageCanvas.getContext('2d');
    if (!ctx) return;
    // JPEG는 투명 배경이 검게 나오므로 흰색으로 채운다
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

    let outputTop = 0;
    if (slice.repeatedHeader) {
      const headerHeight = slice.repeatedHeader.bottom - slice.repeatedHeader.top;
      ctx.drawImage(
        canvas,
        0,
        slice.repeatedHeader.top,
        canvas.width,
        headerHeight,
        0,
        0,
        canvas.width,
        headerHeight,
      );
      outputTop = headerHeight;
    }

    ctx.drawImage(
      canvas,
      0,
      slice.sourceTop,
      canvas.width,
      slice.sourceHeight,
      0,
      outputTop,
      canvas.width,
      slice.sourceHeight,
    );

    const sliceHeightMm = slice.outputHeight / pxPerMm;
    const imgData = pageCanvas.toDataURL(mime, quality);

    if (pageIndex > 0) {
      pdf.addPage();
    }
    pdf.addImage(imgData, imageType, MARGIN_MM, MARGIN_MM, PRINTABLE_WIDTH_MM, sliceHeightMm);

  });

  return pageSlices.length;
}

export async function generatePDF({
  element,
  filename,
  scale = 2,
  imageType = 'JPEG',
  quality = 0.85,
  maxSizeMB = 5,
  download = true,
}: GeneratePDFOptions): Promise<GeneratePDFResult | void> {
  // 출력할 때만 PDF 라이브러리를 불러온다.
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  // Portal 내부 요소 문제 해결: 요소를 복제하여 body에 임시로 추가
  const clone = element.cloneNode(true) as HTMLElement;

  // A4 너비에 맞춰 고정 (210mm = 794px @96dpi)
  const a4WidthPx = 794;

  // 복제된 요소 스타일 설정 (화면 밖에 위치)
  clone.style.position = 'absolute';
  clone.style.left = '-9999px';
  clone.style.top = '0';
  clone.style.width = `${a4WidthPx}px`;
  clone.style.maxWidth = `${a4WidthPx}px`;
  clone.style.backgroundColor = '#ffffff';
  clone.style.padding = '20px';
  clone.style.boxSizing = 'border-box';

  // print:hidden 클래스를 가진 요소들 제거
  const hiddenElements = clone.querySelectorAll('.print\\:hidden');
  hiddenElements.forEach((el) => el.remove());

  // body에 추가
  document.body.appendChild(clone);

  // 스타일 적용을 위해 잠시 대기
  await new Promise((resolve) => setTimeout(resolve, 100));

  try {
    // 1. HTML을 Canvas로 변환 (html2canvas는 한 번만 실행, 이후 재인코딩은 캔버스 재사용)
    const canvas = await html2canvas(clone, {
      scale,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      allowTaint: true,
      width: a4WidthPx,
      windowWidth: a4WidthPx,
      // 확인서는 인라인 스타일로 완결된다. 앱의 Tailwind 테마(oklch)와
      // 모달 스타일을 캡처 사본에서 제외해 화면 밖에서도 같은 문서를 만든다.
      onclone: (doc) => {
        doc.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => node.remove());
        const reset = doc.createElement('style');
        reset.textContent = '*{box-sizing:border-box;border:0 solid #000}p,h1{margin:0}body{margin:0}';
        doc.head.appendChild(reset);
        for (const root of [doc.documentElement, doc.body]) {
          root.style.backgroundColor = '#ffffff';
          root.style.color = '#000000';
        }
      },
    });
    const pagination = readCanvasPagination(clone, canvas);

    // 2. 품질을 단계적으로 낮춰가며 maxSizeMB 이하를 만족하는 PDF를 생성
    //    (PNG는 무손실이라 한 번만 시도)
    const maxBytes = maxSizeMB * 1024 * 1024;
    const qualitySteps =
      imageType === 'PNG' ? [1] : [quality, 0.7, 0.6, 0.5, 0.4, 0.3];

    let pdf: import('jspdf').jsPDF | null = null;
    let blob: Blob | null = null;
    let usedQuality = qualitySteps[0];
    let pages = 0;

    for (const q of qualitySteps) {
      const candidate = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true,
      });
      const candidatePages = addCanvasAsPages(candidate, canvas, imageType, q, pagination);
      const candidateBlob = candidate.output('blob');

      pdf = candidate;
      blob = candidateBlob;
      usedQuality = q;
      pages = candidatePages;

      if (candidateBlob.size <= maxBytes) {
        break;
      }
    }

    if (!pdf || !blob) {
      return;
    }

    // 3. 다운로드 (마지막으로 생성된 PDF 사용)
    if (download) {
      pdf.save(filename);
    }

    return { sizeBytes: blob.size, pages, quality: usedQuality, blob };
  } finally {
    // 임시 요소 제거
    document.body.removeChild(clone);
  }
}
