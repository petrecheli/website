import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { TooltipDirective } from '../../../directives';
import {
  Gamemode,
  Leaderboard,
  LeaderboardStats,
  LeaderboardType,
  MapReview,
  MapReviewSuggestion,
  MapStatusChangers,
  MapStatusNameNew,
  MapStatusNew,
  MapSubmissionApproval,
  MapSubmissionSuggestion,
  MIN_PUBLIC_TESTING_DURATION,
  MMap,
  PagedResponse,
  Role,
  TrackType
} from '@momentum/constants';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { DatePipe, JsonPipe, KeyValuePipe, NgClass } from '@angular/common';
import { MessageService } from 'primeng/api';
import { ChartModule } from 'primeng/chart';
import { from, leaderboardKey } from '@momentum/util-fn';
import * as Chart from 'chart.js';
import { CalendarModule } from 'primeng/calendar';
import { DropdownModule } from 'primeng/dropdown';
import { firstValueFrom, forkJoin } from 'rxjs';
import { IconComponent } from '../../../icons';
import { PluralPipe, TimingPipe, UnsortedKeyvaluePipe } from '../../../pipes';
import { SubmissionTypeInfoComponent } from '../../tooltips/submission-type-info.component';
import { LeaderboardsService, MapsService } from '../../../services';
import { AccordionModule } from 'primeng/accordion';
import { AccordionComponent } from '../../accordion/accordion.component';
import { AccordionItemComponent } from '../../accordion/accordion-item.component';
import { IterableElement } from 'type-fest';
import { SliderComponent } from '../../slider/slider.component';
import { MapFinalApprovalFormComponent } from './map-final-approval-form.component';

export type GroupedLeaderboards = Map<
  Gamemode,
  {
    leaderboards: Array<
      Leaderboard & {
        totalRuns: number;
        subSugg?: MapSubmissionSuggestion;
        reviews: MapReviewSuggestion[];
        graphs: { tiers: Chart.ChartData; ratings: any };
        averageTier?: number;
        averageRating?: number;
        tier: number | null;
        type: Exclude<LeaderboardType, LeaderboardType.IN_SUBMISSION> | null;
      }
    >;
    totalRuns: number;
  }
>;

@Component({
  selector: 'm-map-status-form',
  templateUrl: 'map-status-form.component.html',
  standalone: true,
  imports: [
    TooltipDirective,
    ReactiveFormsModule,
    IconComponent,
    PluralPipe,
    CalendarModule,
    DropdownModule,
    SubmissionTypeInfoComponent,
    JsonPipe,
    TimingPipe,
    DatePipe,
    ChartModule,
    UnsortedKeyvaluePipe,
    KeyValuePipe,
    AccordionModule,
    AccordionComponent,
    AccordionItemComponent,
    SliderComponent,
    MapFinalApprovalFormComponent,
    NgClass
  ]
})
export class MapStatusFormComponent implements OnChanges {
  protected readonly MapStatus = MapStatusNew;
  protected readonly MapStatusName = MapStatusNameNew;
  protected readonly MIN_PUBLIC_TESTING_DURATION = MIN_PUBLIC_TESTING_DURATION;
  @Input({ required: true }) map: MMap;
  @Input({ required: true }) sub: boolean;
  @Input({ required: true }) adm: boolean;
  @Input({ required: true }) mod: boolean;
  @Input({ required: true }) rev: boolean;

  @Input({ required: true }) formGroup: FormGroup<{
    status: FormControl<MapStatusNew>;
    finalLeaderboards: FormControl<MapSubmissionApproval[]>;
  }>;

  protected status: MapStatusNew;
  protected possibleStatuses: Array<{
    label: string;
    value: MapStatusNew | -1; // PrimeNG component behaves weirdly for `null`
  }> = [];

  protected firstEnteredPublicTesting: number;
  protected isBlockedForUnresolvedReviews: boolean;
  protected isBlockedForSubmissionTimeGate: boolean;
  protected hasBeenApprovedBefore: boolean;

  protected loading = false;

  protected groupedLeaderboards: GroupedLeaderboards = new Map();

  constructor(
    private readonly mapsService: MapsService,
    private readonly leaderboardsService: LeaderboardsService,
    private readonly messageService: MessageService
  ) {}

  async ngOnChanges(changes: SimpleChanges) {
    if (!changes['map'] || !this.map) return;
    this.isBlockedForUnresolvedReviews = false;
    this.isBlockedForSubmissionTimeGate = false;

    this.status = this.map.status;

    this.populateStatuses();

    if (
      ![MapStatusNew.FINAL_APPROVAL, MapStatusNew.PUBLIC_TESTING].includes(
        this.status
      )
    )
      return;

    this.loading = true;
    let reviews: PagedResponse<MapReview>, leaderboardStats: LeaderboardStats[];
    try {
      [reviews, leaderboardStats] = await firstValueFrom(
        forkJoin([
          this.mapsService.getMapReviews(this.map.id, {
            take: 1000
          }),
          this.leaderboardsService.getLeaderboardStats(this.map.id)
        ])
      );
    } catch (error) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error fetching map summary data!!',
        detail: error.message
      });
      this.loading = false;
      return;
    }

    this.setupFinalApprovalForm(leaderboardStats, reviews.data);
    this.hasBeenApprovedBefore = this.map.submission.dates.some(
      (date) => date.status === MapStatusNew.APPROVED
    );

    this.firstEnteredPublicTesting = new Date(
      this.map.submission.dates
        .filter(({ status }) => status === MapStatusNew.PUBLIC_TESTING)
        .at(-1)?.date
    ).getTime();
    this.isBlockedForSubmissionTimeGate =
      Date.now() - this.firstEnteredPublicTesting < MIN_PUBLIC_TESTING_DURATION;

    this.isBlockedForUnresolvedReviews = reviews.data.some(
      ({ resolved }) => resolved === false
    );

    if (
      this.isBlockedForSubmissionTimeGate ||
      this.isBlockedForUnresolvedReviews
    ) {
      this.possibleStatuses.splice(
        this.possibleStatuses.findIndex(
          ({ value }) => value === MapStatusNew.FINAL_APPROVAL
        ),
        1
      );
    }

    this.loading = false;
  }

  // This is all so heavily dependent on map and review data that we construct
  // all this graph stuff here, then pass it to the child m-final-approval-form
  // component, which actually renders it.
  setupFinalApprovalForm(
    leaderboardStats: LeaderboardStats[],
    reviews: MapReview[]
  ) {
    const subSuggs = this.map.submission.suggestions;
    const reviewSuggs = reviews.flatMap(({ suggestions }) => suggestions);
    const arr10 = from(10, (_, i) => i + 1);
    const style = getComputedStyle(document.documentElement);
    const tierColors = arr10.map((k) => style.getPropertyValue(`--tier-${k}`));
    const ratingColors = ['blue', 'green', 'orange', 'red', 'purple'].map(
      (color) => style.getPropertyValue(`--${color}-500`)
    );

    const leaderboards = leaderboardStats.map(({ leaderboard, totalRuns }) => {
      const matchTrack = ({ gamemode, trackType, trackNum }) =>
        leaderboard.gamemode === gamemode &&
        leaderboard.trackType === trackType &&
        leaderboard.trackNum === trackNum;

      const subSugg = subSuggs.find((sugg) => matchTrack(sugg));
      const reviews = reviewSuggs.filter((review) => matchTrack(review));

      const r: IterableElement<GroupedLeaderboards>[1]['leaderboards'][0] = {
        ...leaderboard,
        totalRuns,
        subSugg,
        reviews,
        graphs: {
          tiers: {
            labels: arr10,
            datasets: [
              {
                data: arr10.map(
                  (k) => reviews.filter(({ tier }) => tier === k).length
                ),
                backgroundColor: tierColors.map(
                  (color) =>
                    `color-mix(in hsl, rgb(${color}), 100% hsl(none 50 50))` // Lower saturation, lighten a bit. Going a bit mad today.
                ),
                categoryPercentage: 1,
                barPercentage: 1
              }
            ]
          },
          ratings: {
            labels: arr10,
            datasets: [
              {
                data: arr10.map(
                  (k) =>
                    reviews.filter(({ gameplayRating }) => gameplayRating === k)
                      .length
                ),
                backgroundColor: arr10.map(
                  (i) =>
                    `color-mix(in hsl, rgb(${
                      ratingColors[i % 5]
                    }), 100% hsl(none 50 50))`
                ),
                categoryPercentage: 1,
                barPercentage: 1
              }
            ]
          }
        },
        // These are the actual values that the form mutates
        tier: null,
        type: LeaderboardType.HIDDEN
      };

      if (reviews.length > 0) {
        // Mean including submitter, i.e.
        let sumTiers = reviews.reduce((acc, { tier }) => acc + tier, 0);
        let totalTiers = reviews.filter(({ tier }) => tier > 0).length;
        if (subSugg.tier > 0) {
          sumTiers += subSugg.tier;
          totalTiers++;
        }
        r.averageTier = +(sumTiers / totalTiers).toFixed(2);

        const sumRatings = reviewSuggs.reduce(
          (acc, { gameplayRating }) => acc + gameplayRating,
          0
        );
        const totalRatings = reviewSuggs.filter(
          ({ gameplayRating }) => gameplayRating != null
        ).length;

        r.averageRating = +(sumRatings / totalRatings).toFixed(2);
      }

      return r;
    });

    this.groupedLeaderboards.clear();
    for (const lb of leaderboards) {
      let group = this.groupedLeaderboards.get(lb.gamemode);
      if (!group) {
        group = { leaderboards: [], totalRuns: 0 };
        this.groupedLeaderboards.set(lb.gamemode, group);
      }
      group.leaderboards.push(lb);

      // Maybe want to include this back when we do stage tiers
      if (lb.trackType !== TrackType.STAGE) {
        group.totalRuns += lb.totalRuns;
      }
    }
  }

  populateStatuses() {
    this.possibleStatuses = [
      { label: 'No change', value: -1 },
      ...MapStatusChangers.filter(
        ({ from, roles }) =>
          this.status === from &&
          ((roles.includes(Role.ADMIN) && this.adm) ||
            (roles.includes(Role.MODERATOR) && this.mod) ||
            (roles.includes(Role.REVIEWER) && this.rev) ||
            (roles.includes('submitter') && this.sub))
      ).map(({ to }) => ({ value: to, label: MapStatusNameNew.get(to) }))
    ];
  }

  isPossibleStatus(status: MapStatusNew) {
    return this.possibleStatuses.some(({ value }) => value === status);
  }

  protected groupLbSortFn = (a, b) => a.value.totalRuns > b.value.totalRuns;
  protected leaderboardKey = leaderboardKey;

  get statusControl() {
    return this.formGroup.get('status') as FormControl<MapStatusNew>;
  }

  get finalLeaderboards() {
    return this.formGroup.get('finalLeaderboards') as FormControl<
      MapSubmissionApproval[]
    >;
  }
  protected readonly MapStatusNew = MapStatusNew;
}