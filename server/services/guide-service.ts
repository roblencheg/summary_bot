import type { GuideRepository, GuideVideo } from '~server/repositories/guide-repository';

export class GuideService {
  constructor(private readonly repo: GuideRepository) {}

  getVideo(): Promise<GuideVideo | null> {
    return this.repo.getVideo();
  }
}
