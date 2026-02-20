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
    // 1. Unpack Mosaic's query object: { type, sql } or a raw SQL string.
    const isObj =
      typeof queryInput === 'object' && queryInput !== null && queryInput.sql;
    const sql = isObj ? queryInput.sql : String(queryInput);
    const type: string = (isObj && queryInput.type) || 'arrow';

    this.options.logger?.log(
      `[HttpArrowConnector] Fetching (${type}): ${sql.substring(0, 60)}...`,
    );

    // 2. Perform Fetch with injected Headers
    const response = await fetch(this.options.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.options.headers,
      },
      body: JSON.stringify({ sql, type }),
    });

    if (!response.ok) {
      const text = await response.text();
      const errMsg = `Remote Query Failed (${response.status}): ${text}`;
      this.options.logger?.error(errMsg, null);
      throw new Error(errMsg);
    }

    // 3. Branch on type, matching Mosaic's Connector contract:
    //    - exec: no result data (DDL/DML statements)
    //    - arrow: decode binary Arrow IPC into a queryable table
    //    - json: parse as JSON
    if (type === 'exec') {
      return undefined;
    }

    const buffer = await response.arrayBuffer();

    this.options.logger?.log(
      `[HttpArrowConnector] Received ${buffer.byteLength} bytes`,
    );

    if (type === 'json') {
      return JSON.parse(new TextDecoder().decode(buffer));
    }

    return decodeIPC(buffer);
  }
}
