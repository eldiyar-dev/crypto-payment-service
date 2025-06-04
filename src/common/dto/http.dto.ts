import { ApiProperty } from '@nestjs/swagger'

export class HttpMessageDto {
  @ApiProperty({
    oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }],
  })
  message: string | string[]

  @ApiProperty({ type: Boolean, example: true })
  success: boolean
}
