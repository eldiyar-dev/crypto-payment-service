import { StoreWalletUseCase } from '@/application/usecases/manageWallets/store-wallet.usecase'
import { HttpMessageDto } from '@/common/dto/http.dto'
import { ApiKeyGuard, IpWhitelistGuard } from '@/common/guards'
import { IRequest } from '@/common/interfaces/reqest.interfaces'
import { isValidChainAddress, privateKeyMatchesAddress } from '@/common/utils'
import { Wallet } from '@/domain/entities/wallet.entity'
import { CreateWalletDto, CreateWalletsResponseDto } from '@/presentation/dto/create-wallet.dto'
import { Body, Controller, HttpCode, HttpException, HttpStatus, Logger, Post, Request, UseGuards } from '@nestjs/common'
import { ApiBadRequestResponse, ApiInternalServerErrorResponse, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger'

@ApiTags('Wallets')
@ApiInternalServerErrorResponse({ type: HttpMessageDto })
@ApiBadRequestResponse({ type: HttpMessageDto })
@ApiUnauthorizedResponse({ type: HttpMessageDto })
@Controller()
export class WalletController {
  private readonly logger = new Logger(WalletController.name)

  constructor(private readonly storeWalletUseCase: StoreWalletUseCase) {}

  @UseGuards(ApiKeyGuard, IpWhitelistGuard)
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
        // Validate against the chain the caller declared, with a real checksum check.
        // The previous logic read `if (chain !== Chain.ETH && chain !== wallet.chain)`, so
        // whenever the *detected* chain was ETH any declared chain was accepted — an
        // EVM-format address could be registered as BTC or TRON.
        if (!isValidChainAddress(wallet.address, wallet.chain)) {
          invalidWallets.push(wallet.address)
          continue
        }

        // The address must be the one this private key actually controls. Without this the
        // service will monitor an address it cannot sweep: deposits are detected, every
        // withdrawal fails, and the funds are stranded.
        if (!privateKeyMatchesAddress(wallet.privateKey, wallet.address, wallet.chain)) {
          this.logger.error(`Rejecting wallet ${wallet.address}: private key does not control this address on ${wallet.chain}`)
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
