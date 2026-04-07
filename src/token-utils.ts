/**
 * Utility functions for generating and managing dataesb API tokens
 */

// Import crypto for MD5 hashing
import crypto from 'crypto';

export interface TokenConfig {
  token: string;  // Static token like 'c65b777e8fea'
  openid: string; // User openid like 'omLAR58PwCSz55nLxMmSjAHkkagk'
  secret: string; // Static secret 'TCUWEI2018'
}

export interface AuthResponse {
  status?: string;
  code?: number;
  message?: string;
  data?: {
    access_token?: string;
    expires_in?: number; // Usually in seconds
    token_type?: string;
    refresh_token?: string;
    openid?: string;
    loginname?: string;
    username?: string;
    is_snapshotuser?: number;
  };
}

/**
 * Generate MD5 hash for sign parameter
 */
export function generateSign(openid: string, timestamp: number, secret: string): string {
  const data = openid + timestamp + secret;
  return crypto.createHash('md5').update(data).digest('hex');
}

/**
 * Fetch a new authentication token from dataesb API
 */
export async function fetchNewAuthToken(config: TokenConfig): Promise<string | null> {
  const timestamp = Math.floor(Date.now() / 1000); // Current time in seconds
  const sign = generateSign(config.openid, timestamp, config.secret);
  
  const url = new URL('https://b.dataesb.com/api/v1/openidAuthorization/uweiVue');
  url.searchParams.append('token', config.token);
  url.searchParams.append('sign', sign);
  url.searchParams.append('time', timestamp.toString());
  url.searchParams.append('openid', config.openid);
  
  console.log(`Fetching new auth token from: ${url.toString()}`);
  
  try {
    const response = await fetch(url.toString(), {
      headers: {
        'accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`Token API request failed with status: ${response.status}`);
      const text = await response.text();
      console.error(`Response: ${text}`);
      return null;
    }

    const data: AuthResponse = await response.json();
    
    if ((data.code === 200 || data.code === 201) && data.data?.access_token) {
      console.log(`Successfully fetched new auth token, expires in: ${data.data.expires_in} seconds`);
      return data.data.access_token;
    } else {
      console.error(`Token API error: ${data.message || 'Unknown error'}`);
      return null;
    }
  } catch (error) {
    console.error(`Failed to fetch auth token: ${error}`);
    return null;
  }
}

/**
 * Check if a token is likely expired based on JWT structure
 */
export function isTokenExpired(token: string): boolean {
  try {
    // JWT tokens have 3 parts: header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.log('Token is not a valid JWT format, assuming it might be expired');
      return true; // Not a JWT, can't check expiration
    }
    
    // Decode the payload (middle part)
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    
    // Check expiration time (exp is in seconds since epoch)
    if (payload.exp) {
      const now = Math.floor(Date.now() / 1000); // Current time in seconds
      const expiresAt = payload.exp;
      
      // Consider token expired if it's within 5 minutes of expiring
      const bufferSeconds = 300;
      return now >= (expiresAt - bufferSeconds);
    }
    
    // No expiration claim, can't determine
    console.log('Token has no expiration claim, assuming it might be expired');
    return true;
  } catch (error) {
    console.error(`Error checking token expiration: ${error}`);
    return true; // Assume expired if we can't check
  }
}

/**
 * Get token from environment and refresh if needed
 */
export async function getAuthToken(env: {
  AUTH_TOKEN?: string;
  DATAESB_TOKEN?: string;
  DATAESB_OPENID?: string;
  DATAESB_SECRET?: string;
  AUTH_TOKEN_STORE?: KVNamespace;
}): Promise<string | null> {
  const KV_KEY = 'dataesb_auth_token';
  const KV_EXPIRY_KEY = 'dataesb_auth_token_expiry';
  
  // Check if we have a stored token
  if (env.AUTH_TOKEN_STORE) {
    try {
      const storedToken = await env.AUTH_TOKEN_STORE.get(KV_KEY);
      const expiryTime = await env.AUTH_TOKEN_STORE.get(KV_EXPIRY_KEY);
      
      if (storedToken && expiryTime) {
        const now = Math.floor(Date.now() / 1000);
        const expiresAt = parseInt(expiryTime, 10);
        
        // If token is still valid, return it
        if (now < expiresAt) {
          console.log(`Using stored auth token, expires at: ${new Date(expiresAt * 1000).toISOString()}`);
          return storedToken;
        }
      }
    } catch (error) {
      console.error(`Error reading stored token: ${error}`);
    }
  }
  
  // If we have config for generating new token
  if (env.DATAESB_TOKEN && env.DATAESB_OPENID && env.DATAESB_SECRET) {
    console.log('Generating new auth token...');
    const config: TokenConfig = {
      token: env.DATAESB_TOKEN,
      openid: env.DATAESB_OPENID,
      secret: env.DATAESB_SECRET,
    };
    
    const newToken = await fetchNewAuthToken(config);
    
    if (newToken && env.AUTH_TOKEN_STORE) {
      try {
        // Parse JWT to get expiration
        const parts = newToken.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          if (payload.exp) {
            // Store with 1 hour buffer before expiry
            const storeUntil = payload.exp - 3600;
            await env.AUTH_TOKEN_STORE.put(KV_KEY, newToken);
            await env.AUTH_TOKEN_STORE.put(KV_EXPIRY_KEY, storeUntil.toString(), {
              expirationTtl: storeUntil - Math.floor(Date.now() / 1000),
            });
            console.log(`Stored new auth token with expiry at: ${new Date(storeUntil * 1000).toISOString()}`);
          }
        }
      } catch (error) {
        console.error(`Error storing new token: ${error}`);
      }
    }
    
    return newToken;
  }
  
  // Fallback to static AUTH_TOKEN from environment
  if (env.AUTH_TOKEN) {
    console.log('Using static AUTH_TOKEN from environment');
    return env.AUTH_TOKEN;
  }
  
  console.error('No auth token available and no configuration to generate new one');
  return null;
}