import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common'

@Injectable()
export class TrimPipe implements PipeTransform {
  private isObj(obj: any): boolean {
    return typeof obj === 'object' && obj !== null
  }

  private trim(values: object) {
    Object.keys(values).forEach((key) => {
      if (typeof values[key] === 'string') {
        values[key] = values[key].trim()
      } else if (this.isObj(values[key])) {
        values[key] = this.trim(values[key] as object)
      }
    })
    return values
  }

  transform(values: any, metadata: ArgumentMetadata) {
    if (this.isObj(values) && ['body', 'param', 'query'].includes(metadata.type)) return this.trim(values as object)

    if (typeof values === 'string') return values.trim()

    return values as object
  }
}
