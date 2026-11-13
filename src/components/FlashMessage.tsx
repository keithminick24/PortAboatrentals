import { Notice } from "./ui";

export default function FlashMessage({ msg, err }: { msg?: string; err?: string }) {
  if (!msg && !err) return null;
  return <div className="mb-4">{err ? <Notice tone="error">{err}</Notice> : <Notice tone="success">{msg}</Notice>}</div>;
}
