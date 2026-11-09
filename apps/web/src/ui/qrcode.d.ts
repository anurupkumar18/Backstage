/** Minimal types for the qrcode package (no @types dependency). Only the API this app uses. */
declare module "qrcode" {
  export interface QRCodeToStringOptions {
    type?: "svg" | "utf8" | "terminal";
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    margin?: number;
    width?: number;
    color?: { dark?: string; light?: string };
  }
  export function toString(text: string, options?: QRCodeToStringOptions): Promise<string>;
  const QRCode: { toString: typeof toString };
  export default QRCode;
}
