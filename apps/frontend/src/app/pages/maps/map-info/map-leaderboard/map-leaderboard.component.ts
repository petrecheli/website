import { Component, Input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';
import {
  NbToastrService,
  NbCardModule,
  NbButtonModule,
  NbSelectModule,
  NbOptionModule,
  NbInputModule,
  NbRadioModule,
  NbUserModule,
  NbIconModule
} from '@nebular/theme';
import {
  Gamemode,
  GamemodeName,
  LeaderboardRun,
  MMap,
  PagedResponse,
  TrackType
} from '@momentum/constants';
import { LeaderboardsService } from '@momentum/frontend/data';
import { Observable } from 'rxjs';
import { TimeAgoPipe } from '../../../../../../../../libs/frontend/pipes/src/lib/time-ago.pipe';
import { TimingPipe } from '../../../../../../../../libs/frontend/pipes/src/lib/timing.pipe';
import { NbIconIconDirective } from '../../../../../../../../libs/frontend/directives/src/lib/icons/nb-icon-icon.directive';
import { NgClass, NgStyle, NgFor, NgIf } from '@angular/common';

enum LeaderboardType {
  TOP10,
  AROUND,
  FRIENDS
}

@Component({
  selector: 'mom-map-leaderboard',
  templateUrl: './map-leaderboard.component.html',
  styleUrls: ['./map-leaderboard.component.scss'],
  standalone: true,
  imports: [
    NbCardModule,
    NbButtonModule,
    NgClass,
    NgStyle,
    NbSelectModule,
    NgFor,
    NbOptionModule,
    NbInputModule,
    NbRadioModule,
    NgIf,
    RouterLink,
    NbUserModule,
    NbIconModule,
    NbIconIconDirective,
    TimingPipe,
    TimeAgoPipe
  ]
})
export class MapLeaderboardComponent {
  protected readonly LeaderboardType = LeaderboardType;
  protected readonly GamemodeName = GamemodeName;

  private map: MMap;
  @Input()
  set setMap(map: MMap) {
    this.map = map;
    // Just handling main tracks for now - we should do stages, bonuses and
    // styles in the future.
    this.availableModes = map.leaderboards
      ?.filter(({ trackType }) => trackType === TrackType.MAIN)
      // Put ranked stuff at the front: if B is ranked and A isn't, put B first,
      // otherwise unchanged.
      .sort((a, b) => (b.ranked && !a.ranked ? 1 : 0))
      .map(({ gamemode }) => gamemode);
    this.selectedMode = this.availableModes[0];
    this.loadLeaderboardRuns();
  }

  protected availableModes: Gamemode[];
  protected selectedMode: Gamemode;
  protected filterActive: boolean;
  protected leaderboardRuns: LeaderboardRun[];
  protected searchedRanks: boolean;
  protected filterLeaderboardType: LeaderboardType;

  constructor(
    private leaderboardService: LeaderboardsService,
    private router: Router,
    private toasterService: NbToastrService
  ) {
    this.filterActive = false;
    this.searchedRanks = false;
    this.leaderboardRuns = [];
    this.LeaderboardType = LeaderboardType;
    this.filterLeaderboardType = LeaderboardType.TOP10;
  }

  filterLeaderboardRuns(
    gamemode: Gamemode,
    mapID?: number
  ): Observable<PagedResponse<LeaderboardRun>> {
    switch (this.filterLeaderboardType) {
      case this.LeaderboardType.TOP10:
        return this.leaderboardService.getRuns(mapID ?? this.map.id, {
          gamemode,
          take: 10
        });

      case this.LeaderboardType.AROUND:
        return this.leaderboardService.getAroundFriends(mapID ?? this.map.id, {
          gamemode
        });

      case this.LeaderboardType.FRIENDS:
        return this.leaderboardService.getFriendRuns(mapID ?? this.map.id, {
          gamemode
        });

      // No default
    }
  }

  loadLeaderboardRuns() {
    this.leaderboardRuns.map(({ rank }) => rank);
    this.searchedRanks = false;
    this.filterLeaderboardRuns(this.selectedMode, this.map.id)
      .pipe(finalize(() => (this.searchedRanks = true)))
      .subscribe({
        next: (response) => {
          this.leaderboardRuns = response.data;
        },
        error: (error) =>
          this.toasterService.danger(error.message, 'Could not find runs')
      });
  }

  viewRun(run: LeaderboardRun) {
    this.router.navigate(['/dashboard/runs/' + run.pastRunID]);
  }
}