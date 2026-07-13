export type DevSessionResponse = {
  success?: boolean;
  data?: {
    access_token?: string;
    refresh_token?: string;
  };
};

export async function readDevSessionResponse(response: Response): Promise<DevSessionResponse | null> {
  const body = await response.text();
  if (!body.trim()) return null;

  try {
    return JSON.parse(body) as DevSessionResponse;
  } catch {
    return null;
  }
}
