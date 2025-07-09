import { StoreWalletUseCase } from '@/application/usecases/manageWallets/store-wallet.usecase'
import { HttpMessageDto } from '@/common/dto/http.dto'
import { Chain } from '@/common/enums'
import { IRequest } from '@/common/interfaces/reqest.interfaces'
import { detectBlockchainNetwork } from '@/common/utils'
import { Wallet } from '@/domain/entities/wallet.entity'
import { CreateWalletDto, CreateWalletsResponseDto } from '@/presentation/dto/create-wallet.dto'
import { Body, Controller, HttpCode, HttpException, HttpStatus, Logger, Post, Request } from '@nestjs/common'
import { ApiBadRequestResponse, ApiInternalServerErrorResponse, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger'

@ApiTags('Wallets')
@ApiInternalServerErrorResponse({ type: HttpMessageDto })
@ApiBadRequestResponse({ type: HttpMessageDto })
@ApiUnauthorizedResponse({ type: HttpMessageDto })
@Controller()
export class WalletController {
  private readonly logger = new Logger(WalletController.name)

  constructor(private readonly storeWalletUseCase: StoreWalletUseCase) {}

  // @UseGuards(ApiKeyGuard, IpWhitelistGuard)
  @ApiOkResponse({ type: CreateWalletsResponseDto })
  @Post('wallets')
  @HttpCode(HttpStatus.CREATED)
  createWallets(@Request() req: IRequest, @Body() body: CreateWalletDto): CreateWalletsResponseDto {
    try {
      const { clientId } = req
      this.logger.log(`post request received from clientId: ${clientId}`)

      const { wallets } = body

      const validWallets: Wallet[] = []
      const invalidWallets: string[] = []

      for (const wallet of wallets) {
        const chain = detectBlockchainNetwork(wallet.address)
        if (!chain) {
          invalidWallets.push(wallet.address)
          continue
        }

        // If the chain is not ETH or the chain is not the same as the wallet chain, then it is invalid
        if (chain !== Chain.ETH && chain !== wallet.chain) {
          invalidWallets.push(wallet.address)
          continue
        }

        validWallets.push(wallet)
      }

      if (validWallets.length) this.storeWalletUseCase.addWallets(validWallets)

      if (invalidWallets.length) {
        return {
          success: false,
          message: 'Invalid wallets',
          data: { invalidWallets },
        }
      }

      return { success: true, message: 'Wallets saved successfully' }
    } catch (error) {
      this.logger.error(`Error creating wallets ${error.message}`)
      throw new HttpException('Internal server error', HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }
}
