// Hosted: there is no mail server. Reports are published to the client portal instead.
export async function sendMail(_m: unknown): Promise<{ delivered: boolean; file?: string }> {
  return { delivered: false };
}
