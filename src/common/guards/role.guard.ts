import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from '@/common/decorators'
import { Roles as Role } from '@/common/enums'

/**
 * roles guard
 */
@Injectable()
export class RolesGuard implements CanActivate {
  /**
   * contructs the role guard service
   * @param reflector reflector of the guard
   */
  constructor(private readonly reflector: Reflector) {}

  /**
   * checks if the user has allowed permission (role)
   * @param context context of the guard (actual information)
   * @returns returns true if the user has appropriate role
   */
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [context.getHandler(), context.getClass()])
    if (!requiredRoles) {
      return true
    }

    const { user } = context.switchToHttp().getRequest<{ user: { roles: Role[] } }>()

    return user.roles.some((role: Role) => requiredRoles.includes(role))
  }
}
