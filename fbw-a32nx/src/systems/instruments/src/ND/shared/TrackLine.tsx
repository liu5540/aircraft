// Copyright (c) 2021-2023 FlyByWire Simulations
//
// SPDX-License-Identifier: GPL-3.0

import { FSComponent, DisplayComponent, EventBus, VNode, MappedSubject, Subscribable, ConsumerSubject, Subject } from '@microsoft/msfs-sdk';
import { MathUtils } from '@flybywiresim/fbw-sdk';
import { ArmedLateralMode, isArmed, LateralMode } from '@shared/autopilot';
import { DmcEvents } from 'instruments/src/MsfsAvionicsCommon/providers/DmcPublisher';
import { EfisNdMode } from '@shared/NavigationDisplay';
import { NDSimvars } from '../NDSimvarPublisher';
import { FGVars } from '../../MsfsAvionicsCommon/providers/FGDataPublisher';
import { FcuSimVars } from '../../MsfsAvionicsCommon/providers/FcuBusPublisher';
import { Arinc429ConsumerSubject } from '../../MsfsAvionicsCommon/Arinc429ConsumerSubject';

export interface TrackLineProps {
    bus: EventBus,
    isUsingTrackUpMode: Subscribable<boolean>,
}

const TRACK_LINE_Y_POSITION = {
    [EfisNdMode.ROSE_NAV]: 384,
    [EfisNdMode.ARC]: 620,
};

export class TrackLine extends DisplayComponent<TrackLineProps> {
    private readonly lineRef = FSComponent.createRef<SVGLineElement>();

    private readonly sub = this.props.bus.getSubscriber<DmcEvents & FGVars & NDSimvars & FcuSimVars>();

    private readonly ndMode = ConsumerSubject.create(this.sub.on('ndMode').whenChanged(), EfisNdMode.ARC);

    private headingWord = Arinc429ConsumerSubject.create(null);

    private trackWord = Arinc429ConsumerSubject.create(null);

    private lateralModeSub = ConsumerSubject.create(this.sub.on('fg.fma.lateralMode').whenChanged(), null);

    private lateralArmedSub = ConsumerSubject.create(this.sub.on('fg.fma.lateralArmedBitmask').whenChanged(), null);

    private readonly visibility = Subject.create('hidden');

    private readonly rotate = MappedSubject.create(([heading, track]) => {
        if (this.props.isUsingTrackUpMode.get()) {
            return 0;
        }

        if (heading.isNormalOperation() && track.isNormalOperation()) {
            return MathUtils.diffAngle(heading.value, track.value);
        }

        return 0;
    }, this.headingWord, this.trackWord);

    private readonly y = this.ndMode.map((mode) => TRACK_LINE_Y_POSITION[mode] ?? 0);

    private readonly transform = MappedSubject.create(([rotation, y]) => {
        return `rotate(${rotation} 384 ${y})`;
    }, this.rotate, this.y);

    onAfterRender(node: VNode) {
        super.onAfterRender(node);

        this.headingWord.setConsumer(this.sub.on('heading'));
        this.trackWord.setConsumer(this.sub.on('track'));

        this.headingWord.sub(() => this.handleLineVisibility(), true);
        this.trackWord.sub(() => this.handleLineVisibility(), true);
        this.lateralModeSub.sub(() => this.handleLineVisibility(), true);
        this.lateralArmedSub.sub(() => this.handleLineVisibility(), true);
        this.ndMode.sub(() => this.handleLineVisibility(), true);
    }

    private handleLineVisibility() {
        const wrongNDMode = TRACK_LINE_Y_POSITION[this.ndMode.get()] === undefined;

        const headingInvalid = !this.headingWord.get().isNormalOperation();
        const trackInvalid = !this.trackWord.get().isNormalOperation();

        const lateralMode = this.lateralModeSub.get();
        const lateralArmed = this.lateralArmedSub.get();

        const shouldShowLine = (lateralMode === LateralMode.NONE || lateralMode === LateralMode.HDG || lateralMode === LateralMode.TRACK)
            && !isArmed(lateralArmed, ArmedLateralMode.NAV);

        if (wrongNDMode || headingInvalid || trackInvalid || !shouldShowLine) {
            this.visibility.set('hidden');
        } else {
            this.visibility.set('inherit');
        }
    }

    render(): VNode | null {
        return (
            <g ref={this.lineRef} transform={this.transform} visibility={this.visibility}>
                <line x1={384} y1={149} x2={384} y2={this.y} class="rounded shadow" stroke-width={3.0} />
                <line x1={384} y1={149} x2={384} y2={this.y} class="rounded Green" stroke-width={2.5} />
            </g>
        );
    }
}
