import { Chain } from '@/common/enums'
import { ApiProperty } from '@nestjs/swagger'
import { IsEnum, IsPositive, IsString } from 'class-validator'
import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm'

@Unique(['address', 'chain'])
@Entity()
export class Wallet {
  @ApiProperty()
  @IsPositive()
  @PrimaryGeneratedColumn()
  id?: number

  @ApiProperty()
  @IsString()
  @Column({ type: String })
  address: string

  @ApiProperty()
  @IsString()
  @Column({ type: String })
  privateKey: string

  @ApiProperty({ enum: Chain })
  @IsEnum(Chain)
  @Column({ type: String, enum: Chain })
  chain: Chain

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', precision: 0 })
  created_at?: Date

  @ApiProperty()
  @UpdateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP', precision: 0 })
  updated_at?: Date

  @ApiProperty({ nullable: true })
  @DeleteDateColumn({ type: 'timestamp', default: () => 'NULL', nullable: true, precision: 0 })
  deleted_at?: Date | null
}
