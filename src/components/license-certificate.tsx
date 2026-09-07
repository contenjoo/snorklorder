/* eslint-disable @next/next/no-img-element -- PDF와 인쇄에도 같은 직인 이미지를 사용한다. */
// components/LicenseCertificate.tsx - 라이선스 확인서 (A4 + 흑백 프린터 최적화)

'use client';

import React from 'react';
import {
  LicensePeriod,
  LicenseRow,
  formatLicenseDate,
  formatLicenseDateKorean,
} from '@/lib/license-certificate';

interface LicenseCertificateProps {
  snapshot: { slug: string; formData: { schoolName: string; contactName: string }; total: number };
  /** 확인서에 찍을 품목 줄 — 발급 화면에서 고친 값 */
  rows: LicenseRow[];
  /** 사용기간 — 발급 화면에서 직접 입력한 값 */
  period: LicensePeriod;
  /** 발급일 (`YYYY-MM-DD`) */
  issuedAt: string;
  /** 문서 하단 비고 (자유 입력) */
  note?: string;
  /** 학교가 금액까지 요구할 때만 켠다. 기본은 라이선스 내역만 표기 */
  showAmount?: boolean;
}

export default function LicenseCertificate({
  snapshot,
  rows,
  period,
  issuedAt,
  note,
  showAmount = false,
}: LicenseCertificateProps) {
  const documentNumber = snapshot.slug;
  const periodText = `${formatLicenseDate(period.start)} ~ ${formatLicenseDate(period.end)}`;

  const containerStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: '210mm',
    margin: '0 auto',
    backgroundColor: '#fff',
    color: '#000',
    fontFamily: "'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
    fontSize: '13px',
    lineHeight: 1.5,
  };

  const cellStyle: React.CSSProperties = {
    border: '1px solid #333',
    padding: '7px 9px',
    fontSize: '13px',
    verticalAlign: 'middle',
    overflowWrap: 'anywhere',
  };

  const headerCellStyle: React.CSSProperties = {
    ...cellStyle,
    backgroundColor: '#e5e7eb',
    fontWeight: 'bold',
    textAlign: 'center',
    whiteSpace: 'nowrap',
  };

  return (
    <div style={containerStyle} className="document-font">
      <div style={{ padding: '24px' }}>

        {/* ===== 타이틀 ===== */}
        <div style={{
          textAlign: 'center',
          marginBottom: '22px',
          borderBottom: '3px double #000',
          paddingBottom: '16px',
        }}>
          <h1 style={{
            fontSize: '30px',
            fontWeight: 900,
            letterSpacing: '12px',
            margin: 0,
            color: '#000',
          }}>
            라 이 선 스 확 인 서
          </h1>
          <p style={{ fontSize: '13px', color: '#666', marginTop: '6px', letterSpacing: '1px' }}>
            Software License Confirmation
          </p>
        </div>

        {/* ===== 상단 정보 (사용기관 / 공급자) ===== */}
        <div style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
          <div style={{ flex: 1 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={{ ...headerCellStyle, width: '80px' }}>사용기관</td>
                  <td style={{ ...cellStyle, fontWeight: 'bold', fontSize: '14px' }}>
                    {snapshot.formData.schoolName || '-'}
                  </td>
                </tr>
                <tr>
                  <td style={headerCellStyle}>담당자</td>
                  <td style={cellStyle}>{snapshot.formData.contactName || '-'}</td>
                </tr>
                <tr>
                  <td style={headerCellStyle}>문서번호</td>
                  <td style={{ ...cellStyle, fontSize: '12px' }}>{documentNumber}</td>
                </tr>
                <tr>
                  <td style={headerCellStyle}>발급일</td>
                  <td style={cellStyle}>{formatLicenseDate(issuedAt)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style={{ flex: 1.3 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={{ ...headerCellStyle, width: '70px' }}>등록번호</td>
                  <td style={{ ...cellStyle, fontWeight: 'bold', letterSpacing: '1px' }} colSpan={3}>
                    313-86-02193
                  </td>
                </tr>
                <tr>
                  <td style={headerCellStyle}>상호</td>
                  <td style={{ ...cellStyle, fontWeight: 600 }}>(주)오늘배움</td>
                  <td style={{ ...headerCellStyle, width: '50px' }}>성명</td>
                  <td style={{ ...cellStyle, width: '90px', position: 'relative' }}>
                    <span style={{ position: 'relative', zIndex: 1 }}>주방현 (인)</span>
                    <img
                      src="/images/learntodaystamp.webp"
                      alt="직인"
                      style={{
                        position: 'absolute',
                        width: '44px',
                        height: '44px',
                        objectFit: 'contain',
                        opacity: 0.75,
                        top: '50%',
                        right: '6px',
                        transform: 'translateY(-50%)',
                        zIndex: 0,
                      }}
                    />
                  </td>
                </tr>
                <tr>
                  <td style={headerCellStyle}>주소</td>
                  <td style={{ ...cellStyle, fontSize: '12px' }} colSpan={3}>
                    대전 서구 만년로68번길 15-20, 3층 305호
                  </td>
                </tr>
                <tr>
                  <td style={headerCellStyle}>연락처</td>
                  <td style={cellStyle} colSpan={3}>070-8648-1580 | joo@learntoday.kr</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ===== 확인 문구 ===== */}
        <div style={{
          border: '2px solid #000',
          padding: '14px 20px',
          marginBottom: '18px',
          backgroundColor: '#f8f9fa',
          fontSize: '14px',
          lineHeight: 1.7,
        }}>
          주식회사 오늘배움은 위 사용기관에 아래와 같이 소프트웨어 라이선스를 정상적으로
          공급하였으며, 해당 라이선스가 아래 사용기간 동안 유효함을 확인합니다.
        </div>

        {/* ===== 라이선스 내역 ===== */}
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            marginBottom: '16px',
            tableLayout: 'fixed',
          }}
          data-pdf-paginated-table="license-items"
        >
          <colgroup>
            <col style={{ width: '7%' }} />
            <col style={{ width: '31%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '27%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={headerCellStyle}>No</th>
              <th style={{ ...headerCellStyle, textAlign: 'left', paddingLeft: '10px' }}>제품명</th>
              <th style={headerCellStyle}>라이선스 종류</th>
              <th style={headerCellStyle}>수량</th>
              <th style={headerCellStyle}>사용기간</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.productName}-${index}`} style={{ breakInside: "avoid" }}>
                <td style={{ ...cellStyle, textAlign: 'center' }}>{index + 1}</td>
                <td style={{ ...cellStyle, fontWeight: 600 }}>{row.productName}</td>
                <td style={{ ...cellStyle, textAlign: 'center' }}>{row.planText || '-'}</td>
                <td style={{ ...cellStyle, textAlign: 'center' }}>{row.quantityText || '-'}</td>
                <td style={{ ...cellStyle, textAlign: 'center', fontSize: '12px' }}>{periodText}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td style={{ ...cellStyle, textAlign: 'center', color: '#666' }} colSpan={5}>
                  등록된 품목이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {showAmount && (
          <div style={{
            border: '1px solid #333',
            padding: '10px 16px',
            marginBottom: '16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '14px',
          }}>
            <span style={{ fontWeight: 700 }}>공급금액 (VAT 포함)</span>
            <span style={{
              fontWeight: 700,
              fontFamily: "'SF Mono', Consolas, monospace",
              fontVariantNumeric: 'tabular-nums',
            }}>
              ￦ {new Intl.NumberFormat('ko-KR').format(snapshot.total)}
            </span>
          </div>
        )}

        {note?.trim() && (
          <div style={{
            border: '1px solid #333',
            padding: '10px 16px',
            marginBottom: '16px',
            fontSize: '13px',
            whiteSpace: 'pre-wrap',
          }}>
            <strong style={{ marginRight: '8px' }}>비고</strong>
            {note.trim()}
          </div>
        )}

        {/* ===== 발급자 서명 ===== */}
        <div style={{ textAlign: 'center', marginTop: '32px' }}>
          <div style={{ fontSize: '15px', marginBottom: '14px' }}>
            {formatLicenseDateKorean(issuedAt)}
          </div>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '17px',
            fontWeight: 700,
            position: 'relative',
          }}>
            <span>주식회사 오늘배움</span>
            <span>대표이사 주방현</span>
            <span style={{ position: 'relative', display: 'inline-block', width: '58px', height: '58px' }}>
              <span style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: '13px',
                fontWeight: 400,
                color: '#666',
                zIndex: 1,
              }}>
                (인)
              </span>
              <img
                src="/images/learntodaystamp.webp"
                alt="직인"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '58px',
                  height: '58px',
                  objectFit: 'contain',
                  opacity: 0.8,
                  zIndex: 0,
                }}
              />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
