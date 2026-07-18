import { redactSensitive } from '@/common/utils/redact.util'
import { WinstonModule } from 'nest-winston'
import { format, transports } from 'winston'
import 'winston-daily-rotate-file'

/** Scrubs private keys, secrets and credentials out of anything bound for a persistent log file. */
const redactFormat = format((info) => redactSensitive(info) as typeof info)

export const winstonConfig = WinstonModule.createLogger({
  transports: [
    new transports.Console({
      format: format.combine(
        format.timestamp(),
        format.colorize(),
        format.printf(({ timestamp, level, message, context }: { timestamp: string; level: string; message: string; context: string }) => {
          return `${timestamp} [${context}] ${level}: ${message}`
        }),
      ),
    }),
    new transports.DailyRotateFile({
      // %DATE will be replaced by the current date
      filename: `logs/%DATE%-error.log`,
      level: 'error',
      format: format.combine(redactFormat(), format.timestamp(), format.json()),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: false, // don't want to zip our logs
      maxFiles: '30d', // will keep log until they are older than 30 days
    }),
    // same for all levels
    new transports.DailyRotateFile({
      filename: `logs/%DATE%-combined.log`,
      format: format.combine(redactFormat(), format.timestamp(), format.json()),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: false,
      maxFiles: '30d',
    }),
  ],
})
