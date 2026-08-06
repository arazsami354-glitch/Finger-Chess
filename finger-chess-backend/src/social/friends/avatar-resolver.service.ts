import { Injectable } from '@nestjs/common';
import { UploadService } from '../../upload/upload.service';

interface AvatarBearing {
  avatarKey?: string | null;
}

/**
 * Deliberately a thin, separate service rather than a method on
 * FriendsService or UploadService — this is a controller-layer concern
 * (resolve for display) applied selectively to the handful of endpoints
 * that actually serialize a response to a client, never to the several
 * internal call sites (social.gateway.ts's presence targeting,
 * FriendsService's own mutual-friend/suggestion computation) that reuse
 * the same underlying data purely for IDs.
 */
@Injectable()
export class AvatarResolverService {
  constructor(private readonly upload: UploadService) {}

  async resolveOne<T extends AvatarBearing>(entity: T): Promise<T & { avatarUrl: string | null }> {
    return { ...entity, avatarUrl: await this.upload.getAvatarUrl(entity.avatarKey ?? null) };
  }

  async resolveList<T extends AvatarBearing>(entities: T[]): Promise<(T & { avatarUrl: string | null })[]> {
    return Promise.all(entities.map((e) => this.resolveOne(e)));
  }
}
