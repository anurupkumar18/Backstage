import { useEffect, useState } from "react";
import QRCode from "qrcode";

export interface JoinQrProps {
  url: string;
}

/**
 * Black-on-white QR with a 4-module quiet zone inside a white card, so it scans from a projector or a phone
 * screen in either theme. The SVG markup comes from the qrcode package, generated locally from `url`.
 */
export function JoinQr({ url }: JoinQrProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 4, color: { dark: "#000000", light: "#ffffff" } })
      .then((markup) => {
        if (active) setSvg(markup);
      })
      .catch(() => {
        if (active) {
          setSvg(null);
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [url]);

  return (
    <figure className="join-qr">
      <div className="join-qr__card">
        {svg ? (
          <div className="join-qr__code" role="img" aria-label={`QR code that opens ${url}`} dangerouslySetInnerHTML={{ __html: svg }} />
        ) : failed ? (
          <p role="alert" className="join-qr__error">
            Could not draw the QR code. Type the address below instead.
          </p>
        ) : (
          <div className="join-qr__code join-qr__code--pending" aria-hidden="true" />
        )}
      </div>
      <figcaption className="join-qr__caption">
        <span className="join-qr__title">Scan to join the floor</span>
        <span className="join-qr__url">{url}</span>
      </figcaption>
    </figure>
  );
}
