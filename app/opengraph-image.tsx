import { ImageResponse } from 'next/og';

/** The link preview: the hero's $5 stamp on the page paper, with the product line. */

export const alt = 'Stamp: strangers put a refundable PayPal hold on the line to reach you. Real messages get it back. Spam pays a charity.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const PAPER = '#f8f8f6';
const INK = '#1a1a18';
const INK_3 = '#6e6e67';
const COBALT = '#2347d6';

// Perforations: circles in the page colour along each edge of the stamp's white paper.
function holes(width: number, height: number, r: number, step: number) {
  const out: Array<{ x: number; y: number }> = [];
  for (let x = step / 2; x < width; x += step) out.push({ x, y: 0 }, { x, y: height });
  for (let y = step / 2; y < height; y += step) out.push({ x: 0, y }, { x: width, y });
  return out.map(({ x, y }) => ({ left: x - r, top: y - r, size: 2 * r }));
}

export default function Image() {
  const W = 300;
  const H = 360;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', background: PAPER, padding: '0 96px', gap: 80 }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <div style={{ fontSize: 34, color: INK_3, marginBottom: 28 }}>Stamp</div>
          <div style={{ fontSize: 56, lineHeight: 1.1, color: INK, letterSpacing: -1 }}>Strangers can reach you</div>
          <div style={{ fontSize: 56, lineHeight: 1.1, color: INK_3, letterSpacing: -1 }}>Spam pays a charity</div>
          <div style={{ fontSize: 28, lineHeight: 1.4, color: INK_3, marginTop: 32, maxWidth: 560 }}>
            A small refundable PayPal hold to message you. Real messages get it back.
          </div>
        </div>
        <div style={{ position: 'relative', width: W, height: H, display: 'flex', background: '#ffffff', transform: 'rotate(4deg)', boxShadow: '0 12px 32px rgba(0,0,0,0.10)' }}>
          {holes(W, H, 9, 28).map((h, i) => (
            <div key={i} style={{ position: 'absolute', left: h.left, top: h.top, width: h.size, height: h.size, borderRadius: h.size, background: PAPER }} />
          ))}
          <div
            style={{
              position: 'absolute',
              left: 26,
              top: 26,
              width: W - 52,
              height: H - 52,
              background: COBALT,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: 22,
              color: '#ffffff',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 20, opacity: 0.85 }}>
              <span>Refundable</span>
              <span>USD</span>
            </div>
            <div style={{ fontSize: 132, lineHeight: 1, letterSpacing: -4 }}>$5</div>
            <div style={{ fontSize: 20, opacity: 0.85 }}>to reach @maya</div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
