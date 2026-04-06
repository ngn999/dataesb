export interface Env {
  // Environment variables from wrangler.jsonc
  API_BASE_URL: string;
  BOOK_ID: string;
  LIBRARY_CODE: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  
  // Secret from .dev.vars or wrangler secret put
  AUTH_TOKEN: string;
  
  // KV namespace for storing previous book status
  BOOK_STATUS_STORE: KVNamespace;
}

interface BookDetailsResponse {
  status?: string;
  code?: number;
  message?: string;
  data?: {
    details: {
      title: string;
      author: string;
      isbn: string;
      publisher: string;
      pubdate: string;
      price: string;
      summary: string;
    };
    holdings: {
      total: number;
      list: Array<{
        libName: string;
        localName: string;
        count: number;
        stateList: Record<string, {
          callno: string;
          statrStr: string;
          state: number; // 3 = checked out, other values might mean available
          barcodeLists: Array<{
            barcode: string;
            returnDate: string;
            volInfo: string;
          }>;
        }>;
      }>;
    };
  };
}

// Import Telegram functions
import { sendTelegramMessage, sendBookAvailabilityAlert, TelegramConfig } from './telegram';

/**
 * Fetch book details from the API
 */
async function fetchBookDetails(env: Env): Promise<BookDetailsResponse> {
  const url = `${env.API_BASE_URL}/api/v1/books/details/${env.BOOK_ID}?curlibcode=${env.LIBRARY_CODE}`;
  
  console.log(`Fetching book details from: ${url}`);
  
  const headers = {
    'accept': 'application/json',
    'authorization': `Bearer ${env.AUTH_TOKEN}`,
    'accept-language': 'zh-CN',
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.70(0x18004631) NetType/WIFI Language/ja',
    'priority': 'u=3, i',
  };

  try {
    const response = await fetch(url, {
      headers,
      cf: {
        // Cache the response for 5 minutes to avoid hitting the API too frequently
        cacheTtl: 300,
        cacheEverything: true,
      },
    });

    if (!response.ok) {
      console.error(`API request failed with status: ${response.status}`);
      return {
        status: 'error',
        code: response.status,
        message: `API request failed with status: ${response.status}`,
      };
    }

    const data = await response.json();
    console.log(`Successfully fetched book details`);
    return data;
  } catch (error) {
    console.error(`Failed to fetch book details: ${error}`);
    return {
      status: 'error',
      code: 500,
      message: `Network error: ${error}`,
    };
  }
}

/**
 * Analyze book availability and get summary
 */
interface BookAvailabilitySummary {
  totalCopies: number;
  availableCopies: number;
  checkedOutCopies: number;
  libraries: Array<{
    name: string;
    available: number;
    checkedOut: number;
    callNumbers: string[];
  }>;
  wasPreviouslyUnavailable: boolean; // For tracking status changes
}

function analyzeBookAvailability(response: BookDetailsResponse): BookAvailabilitySummary | null {
  if (!response.data || !response.data.holdings) {
    console.error('No valid book data available');
    return null;
  }

  const { holdings } = response.data;
  const summary: BookAvailabilitySummary = {
    totalCopies: holdings.total,
    availableCopies: 0,
    checkedOutCopies: 0,
    libraries: [],
    wasPreviouslyUnavailable: false,
  };

  holdings.list.forEach(library => {
    const librarySummary = {
      name: library.libName,
      available: 0,
      checkedOut: 0,
      callNumbers: [] as string[],
    };

    Object.values(library.stateList).forEach(stateItem => {
      const isCheckedOut = stateItem.state === 3; // Assuming 3 means checked out
      
      if (isCheckedOut) {
        summary.checkedOutCopies += stateItem.barcodeLists.length;
        librarySummary.checkedOut += stateItem.barcodeLists.length;
      } else {
        summary.availableCopies += stateItem.barcodeLists.length;
        librarySummary.available += stateItem.barcodeLists.length;
      }
      
      if (!librarySummary.callNumbers.includes(stateItem.callno)) {
        librarySummary.callNumbers.push(stateItem.callno);
      }
    });

    summary.libraries.push(librarySummary);
  });

  return summary;
}

/**
 * Format book details for logging/notification
 */
function formatBookDetails(response: BookDetailsResponse, summary: BookAvailabilitySummary): string {
  if (!response.data) {
    return `No data available. Message: ${response.message || 'Unknown error'}`;
  }

  const { details } = response.data;

  let formatted = `📚 Book Status Check\n`;
  formatted += `Title: ${details.title}\n`;
  formatted += `Author: ${details.author}\n`;
  formatted += `ISBN: ${details.isbn}\n`;
  formatted += `Publisher: ${details.publisher} (${details.pubdate})\n\n`;

  formatted += `📋 Availability Summary:\n`;
  formatted += `Total copies: ${summary.totalCopies}\n`;
  formatted += `✅ Available: ${summary.availableCopies}\n`;
  formatted += `❌ Checked out: ${summary.checkedOutCopies}\n\n`;

  // Show library details
  summary.libraries.forEach(library => {
    formatted += `🏛️ ${library.name}:\n`;
    formatted += `  Status: ${library.available} available, ${library.checkedOut} checked out\n`;
    
    if (library.callNumbers.length > 0) {
      formatted += `  Call numbers: ${library.callNumbers.join(', ')}\n`;
    }
    formatted += '\n';
  });

  return formatted;
}

/**
 * Generate Telegram notification for available books
 */
async function notifyIfBooksAvailable(
  env: Env,
  bookDetails: BookDetailsResponse,
  currentSummary: BookAvailabilitySummary
): Promise<void> {
  if (!currentSummary || currentSummary.availableCopies === 0) {
    console.log('No books available, skipping notification');
    return;
  }

  // Check if Telegram is configured
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID || 
      env.TELEGRAM_BOT_TOKEN === 'your-telegram-bot-token-here' || 
      env.TELEGRAM_CHAT_ID === 'your-telegram-chat-id-here') {
    console.log('Telegram bot not configured. Please set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.');
    return;
  }

  const { details } = bookDetails.data!;
  const telegramConfig: TelegramConfig = {
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
  };

  // Check previous status from KV store
  const previousStatusKey = `book:${env.BOOK_ID}:lib:${env.LIBRARY_CODE}:status`;
  const previousStatus = await env.BOOK_STATUS_STORE.get(previousStatusKey);
  
  let wasPreviouslyUnavailable = false;
  if (previousStatus) {
    const previousSummary = JSON.parse(previousStatus) as BookAvailabilitySummary;
    wasPreviouslyUnavailable = previousSummary.availableCopies === 0 && currentSummary.availableCopies > 0;
    
    if (wasPreviouslyUnavailable) {
      console.log('Book status changed from unavailable to available! Sending alert.');
    }
  }

  // Send notification for each library with available books
  for (const library of currentSummary.libraries) {
    if (library.available > 0) {
      // Find the first call number for this library
      const callNumber = library.callNumbers[0] || 'Unknown';
      
      const notificationSent = await sendBookAvailabilityAlert(
        telegramConfig,
        details.title,
        details.author,
        library.name,
        callNumber,
        library.available,
        wasPreviouslyUnavailable
      );

      if (notificationSent) {
        console.log(`Notification sent for ${library.name}: ${library.available} copies available`);
      } else {
        console.error(`Failed to send notification for ${library.name}`);
      }
    }
  }

  // Store current status for next check
  await env.BOOK_STATUS_STORE.put(previousStatusKey, JSON.stringify(currentSummary), {
    expirationTtl: 86400, // Store for 24 hours
  });
}

/**
 * Send summary to Telegram for logging
 */
async function sendSummaryToTelegram(
  env: Env,
  message: string
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID || 
      env.TELEGRAM_BOT_TOKEN === 'your-telegram-bot-token-here' || 
      env.TELEGRAM_CHAT_ID === 'your-telegram-chat-id-here') {
    return;
  }

  const telegramConfig: TelegramConfig = {
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
  };

  await sendTelegramMessage(telegramConfig, message, { parseMode: 'Markdown' });
}

/**
 * Handle scheduled events (cron triggers)
 */
async function handleScheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
  console.log(`[CRON] Running scheduled check at ${new Date().toISOString()}`);
  
  const bookDetails = await fetchBookDetails(env);
  
  if (bookDetails.status === 'error') {
    console.error(`Failed to fetch book details: ${bookDetails.message}`);
    
    // Send error notification to Telegram
    const errorMessage = `❌ Book check failed at ${new Date().toLocaleString()}\nError: ${bookDetails.message}`;
    await sendSummaryToTelegram(env, errorMessage);
    return;
  }

  const summary = analyzeBookAvailability(bookDetails);
  
  if (!summary) {
    console.error('Failed to analyze book availability');
    return;
  }

  const formattedMessage = formatBookDetails(bookDetails, summary);
  console.log(formattedMessage);
  
  // Check and send Telegram notifications if books are available
  await notifyIfBooksAvailable(env, bookDetails, summary);
  
  // Send summary to Telegram for logging (only if configured)
  const timestamp = new Date().toLocaleString();
  const summaryMessage = `📊 Book Check Summary (${timestamp})\nTotal: ${summary.totalCopies} | ✅ Available: ${summary.availableCopies} | ❌ Checked out: ${summary.checkedOutCopies}`;
  await sendSummaryToTelegram(env, summaryMessage);
}

/**
 * Handle HTTP requests (for manual testing)
 */
async function handleRequest(request: Request, env: Env, ctx: ExecutionContext) {
  const url = new URL(request.url);
  
  if (url.pathname === '/check' || url.pathname === '/') {
    // Manual trigger of book check
    console.log(`[HTTP] Manual book check triggered at ${new Date().toISOString()}`);
    
    const bookDetails = await fetchBookDetails(env);
    
    if (bookDetails.status === 'error') {
      return new Response(`Error: ${bookDetails.message}`, {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    const summary = analyzeBookAvailability(bookDetails);
    
    if (!summary) {
      return new Response('Failed to analyze book availability', {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    const formattedMessage = formatBookDetails(bookDetails, summary);
    
    // Check and send Telegram notifications if books are available
    await notifyIfBooksAvailable(env, bookDetails, summary);
    
    // Return formatted response
    return new Response(formattedMessage, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  
  if (url.pathname === '/test-telegram') {
    // Test Telegram notification endpoint
    // First, fetch book details to get book information
    const bookDetails = await fetchBookDetails(env);
    
    if (bookDetails.status === 'error' || !bookDetails.data) {
      return new Response(`Cannot fetch book details for test: ${bookDetails.message}`, {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    
    const { details } = bookDetails.data;
    
    const testMessage = `🤖 *Telegram Bot Test*\n\nThis is a test message from your book tracker bot!\n\n📚 Book: ${details.title}\n✍️ Author: ${details.author}\n📖 Publisher: ${details.publisher}\n\n✅ Bot is working correctly!`;
    
    const telegramConfig: TelegramConfig = {
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId: env.TELEGRAM_CHAT_ID,
    };
    
    // Check if Telegram is configured
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID || 
        env.TELEGRAM_BOT_TOKEN === 'your-telegram-bot-token-here' || 
        env.TELEGRAM_CHAT_ID === 'your-telegram-chat-id-here') {
      return new Response('Telegram bot not configured. Please set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .dev.vars or secrets.', {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    
    const success = await sendTelegramMessage(telegramConfig, testMessage, { parseMode: 'Markdown' });
    
    return new Response(success ? '✅ Telegram test sent!' : '❌ Telegram test failed. Check your bot token and chat ID.', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  
  // Health check endpoint
  if (url.pathname === '/health') {
    return new Response('OK', { status: 200 });
  }
  
  // Default 404
  return new Response('Not Found', { status: 404 });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, ctx);
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduled(event, env, ctx));
  },
};