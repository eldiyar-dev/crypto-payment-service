import { Wallet } from '@/domain/entities/wallet.entity'
import { ApiProperty, PickType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsArray, ValidateNested } from 'class-validator'

export class CreateWalletDto {
  @ApiProperty({
    description: 'The wallets to create',
    isArray: true,
    example: [{ currency: 'BTC', address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', privateKey: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' }],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PickType(Wallet, ['currency', 'address', 'privateKey']))
  wallets: Pick<Wallet, 'currency' | 'address' | 'privateKey'>[]
}

export class CreateWalletsResponseDto {
  @ApiProperty({
    description: 'The message of the response',
    example: 'Wallets saved successfully',
  })
  message: string

  @ApiProperty({
    description: 'The data of the response',
    example: {
      invalidWallets: [],
    },
    required: false,
    nullable: true,
  })
  data?: { invalidWallets?: string[] }
}
