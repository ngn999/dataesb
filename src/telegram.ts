export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface TelegramMessageOptions {
  parseMode?: 'Markdown' | 'HTML' | 'MarkdownV2';
  disableWebPagePreview?: boolean;
  disableNotification?: boolean;
}

/**
 * Send a message via Telegram bot
 */
export async function sendTelegramMessage(
  config: TelegramConfig,
  message: string,
  options: TelegramMessageOptions = {}
): Promise<boolean> {
  const { botToken, chatId } = config;
  const {
    parseMode = 'Markdown',
    disableWebPagePreview = true,
    disableNotification = false,
  } = options;

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: parseMode,
        disable_web_page_preview: disableWebPagePreview,
        disable_notification: disableNotification,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Telegram API error: ${response.status} - ${errorText}`);
      return false;
    }

    console.log('Telegram message sent successfully');
    return true;
  } catch (error) {
    console.error(`Failed to send Telegram message: ${error}`);
    return false;
  }
}

/**
 * Format book availability alert message
 */
export function formatBookAlert(
  bookTitle: string,
  author: string,
  libraryName: string,
  callNumber: string,
  totalAvailable: number,
  lastCheckedOut?: boolean
): string {
  let message = `📚 *Book Available Alert!*\n\n`;
  
  message += `*Title*: ${bookTitle}\n`;
  message += `*Author*: ${author}\n`;
  message += `*Library*: ${libraryName}\n`;
  message += `*Call Number*: ${callNumber}\n`;
  message += `*Available Copies*: ${totalAvailable}\n`;
  
  if (lastCheckedOut) {
    message += `\nℹ️ This book was previously checked out and is now available!\n`;
  }
  
  message += `\n📍 Check it out now before it's gone!`;
  
  return message;
}

/**
 * Send book availability alert via Telegram
 */
export async function sendBookAvailabilityAlert(
  config: TelegramConfig,
  bookTitle: string,
  author: string,
  libraryName: string,
  callNumber: string,
  totalAvailable: number,
  lastCheckedOut?: boolean
): Promise<boolean> {
  const message = formatBookAlert(
    bookTitle,
    author,
    libraryName,
    callNumber,
    totalAvailable,
    lastCheckedOut
  );
  
  return await sendTelegramMessage(config, message, { parseMode: 'Markdown' });
}