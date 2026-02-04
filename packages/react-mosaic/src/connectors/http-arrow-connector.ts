import { decodeIPC } from '@uwdata/mosaic-core';

export interface HttpArrowConnectorOptions {
  /** The full endpoint URL (e.g. "http://localhost:3001/query") */
  url: string;
  /**
   * Headers to inject into every request.
   * Use this for Cloudflare Access IDs, Bearer tokens, or Tenant IDs.
   */
  headers?: Record<string, string>;
  /** Optional logger for debugging transport issues */
  logger?: {
    log: (msg: string) => void;
    error: (msg: string, err: any) => void;
  };
}

/**
 * A generic Mosaic Connector that communicates via HTTP(S) using JSON for the query
 * and expects a binary Apache Arrow IPC stream in response.
 *
 * This connector is designed to be agnostic of the specific backend authentication method,
 * relying on injected headers for security.
 */
export class HttpArrowConnector {
  constructor(private options: HttpArrowConnectorOptions) {}

  // Explicit return type 'Promise<any>' is required here to avoid TS2742.
  // Without it, TS tries to infer the return type from decodeIPC, which
  // references types from '@uwdata/flechette' that are not exported/portable.
  async query(queryInput: any): Promise<any> {
    // 1. Unpack Mosaic's potentially wrapped SQL object.
    // Mosaic Core sometimes wraps the SQL string in a Query object or passes it directly.
    const sql =
      typeof queryInput === 'object' && queryInput !== null && queryInput.sql
        ? queryInput.sql
        : String(queryInput);

    this.options.logger?.log(
      `[HttpArrowConnector] Fetching: ${sql.substring(0, 60)}...`,
    );

    // 2. Perform Fetch with injected Headers
    const response = await fetch(this.options.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.options.headers,
      },
      // The Go server expects { type: 'arrow', sql: ... }
      body: JSON.stringify({ sql, type: 'arrow' }),
    });

    if (!response.ok) {
      const text = await response.text();
      const errMsg = `Remote Query Failed (${response.status}): ${text}`;
      this.options.logger?.error(errMsg, null);
      throw new Error(errMsg);
    }

    // 3. Decode Binary Response
    const buffer = await response.arrayBuffer();

    this.options.logger?.log(
      `[HttpArrowConnector] Received ${buffer.byteLength} bytes`,
    );

    // 4. Hydrate into Mosaic-compatible Table
    // decodeIPC parses the Arrow IPC format into a queryable table structure.
    return decodeIPC(buffer);
  }
}
