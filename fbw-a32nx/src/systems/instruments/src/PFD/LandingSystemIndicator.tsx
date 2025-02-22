// Copyright (c) 2021-2023 FlyByWire Simulations
//
// SPDX-License-Identifier: GPL-3.0

import { ConsumerSubject, DisplayComponent, FSComponent, HEvent, MappedSubject, MathUtils, Subject, Subscribable, SubscribableMapFunctions, Subscription, VNode } from '@microsoft/msfs-sdk';
import { getDisplayIndex } from 'instruments/src/PFD/PFD';
import { Arinc429RegisterSubject } from 'instruments/src/MsfsAvionicsCommon/Arinc429RegisterSubject';
import { Arinc429Values } from './shared/ArincValueProvider';
import { PFDSimvars } from './shared/PFDSimvarPublisher';
import { LagFilter } from './PFDUtils';
import { ArincEventBus } from '../MsfsAvionicsCommon/ArincEventBus';

// FIXME true ref
export class LandingSystem extends DisplayComponent<{ bus: ArincEventBus, instrument: BaseInstrument }> {
    private readonly lsVisible = ConsumerSubject.create(null, false);

    private readonly lsHidden = this.lsVisible.map(SubscribableMapFunctions.not());

    private readonly xtk = ConsumerSubject.create(null, 0);

    // FIXME this seems like a dubious test...
    private readonly xtkValid = this.xtk.map((v) => Math.abs(v) > 0);

    private readonly ldevRequest = ConsumerSubject.create(null, false);

    private readonly altitude2 = Arinc429RegisterSubject.createEmpty();

    private readonly isGsReferenceLineHidden = MappedSubject.create(
        ([lsVisible, altitude]) => !lsVisible && !altitude.isNormalOperation(),
        this.lsVisible,
        this.altitude2,
    );

    private readonly isLDevHidden = MappedSubject.create(
        ([request, xtkValid]) => !request || !xtkValid,
        this.ldevRequest,
        this.xtkValid,
    );

    private readonly isVDevHidden = Subject.create(true);

    onAfterRender(node: VNode): void {
        super.onAfterRender(node);

        const sub = this.props.bus.getSubscriber<PFDSimvars & HEvent & Arinc429Values>();

        // FIXME clean this up.. should be handled by an IE in the XML
        sub.on('hEvent').handle((eventName) => {
            if (eventName === `A320_Neo_PFD_BTN_LS_${getDisplayIndex()}`) {
                SimVar.SetSimVarValue(`L:BTN_LS_${getDisplayIndex()}_FILTER_ACTIVE`, 'Bool', !this.lsVisible.get());
            }
        });

        this.lsVisible.setConsumer(sub.on(getDisplayIndex() === 1 ? 'ls1Button' : 'ls2Button'));

        sub.on('baroCorrectedAltitude').handle((altitude) => {
            this.altitude2.setWord(altitude);
        });

        this.ldevRequest.setConsumer(sub.on(getDisplayIndex() === 1 ? 'ldevRequestLeft' : 'ldevRequestRight'));

        this.xtk.setConsumer(sub.on('xtk'));
    }

    render(): VNode {
        return (
            <>
                <g id="LSGroup" class={{ HiddenElement: this.lsHidden }}>
                    <LandingSystemInfo bus={this.props.bus} isVisible={this.lsVisible} />

                    <g id="LSGroup">
                        <LocalizerIndicator bus={this.props.bus} instrument={this.props.instrument} />
                        <GlideSlopeIndicator bus={this.props.bus} instrument={this.props.instrument} />
                        <MarkerBeaconIndicator bus={this.props.bus} />
                    </g>

                    <path
                        class={{
                            Yellow: true,
                            Fill: true,
                            HiddenElement: this.isGsReferenceLineHidden,
                        }}
                        d="m 114.84887,80.06669 v 1.51188 h -8.43284 v -1.51188 z"
                    />
                </g>
                <g id="DeviationGroup" class={{ HiddenElement: this.lsVisible }}>
                    <g id="LateralDeviationGroup" class={{ HiddenElement: this.isLDevHidden }}>
                        <LDevIndicator bus={this.props.bus} />
                    </g>
                    <g id="VerticalDeviationGroup" class={{ HiddenElement: this.isVDevHidden }}>
                        <VDevIndicator bus={this.props.bus} />
                    </g>
                </g>
                <path
                    class={{
                        Yellow: true,
                        Fill: true,
                        HiddenElement: this.isGsReferenceLineHidden,
                    }}
                    d="m 114.84887,80.06669 v 1.51188 h -8.43284 v -1.51188 z"
                />
            </>
        );
    }
}

interface LandingSystemInfoProps {
    bus: ArincEventBus,
    isVisible: Subscribable<boolean>,
}

class LandingSystemInfo extends DisplayComponent<LandingSystemInfoProps> {
    // source data

    private readonly lsAlive = ConsumerSubject.create(null, false);

    private readonly lsFrequency = ConsumerSubject.create(null, 0);

    private readonly lsIdent = ConsumerSubject.create(null, '');

    private readonly dmeAlive = ConsumerSubject.create(null, false);

    private readonly dmeDistance = ConsumerSubject.create(null, 0);

    private readonly fm1NavDiscrete = Arinc429RegisterSubject.createEmpty();

    // derived subjects

    private readonly lsIdentText = Subject.create('');

    private readonly lsIdentPipe = this.lsIdent.pipe(this.lsIdentText, true);

    private readonly freqTextLeading = this.lsFrequency.map((v) => Math.trunc(v).toString()).pause();

    private readonly freqTextTrailing = this.lsFrequency.map((v) => `.${Math.round((v - Math.trunc(v)) * 100).toString().padStart(2, '0')}`).pause();

    private readonly isLsIdentHidden = MappedSubject.create(
        ([ident, isAlive]) => ident.length === 0 || !isAlive,
        this.lsIdent,
        this.lsAlive,
    );

    private readonly isLsFreqHidden = this.lsFrequency.map((v) => v < 108 || v > 112);

    // FIXME major hack: when the FM is not tuning the VORs and MMRs, the DME receiver is not tuned (goes into standby)
    // Since we use the sim radios at the moment we can't tell that... instead we look at the FM tuning state
    private isDmeAvailable = MappedSubject.create(
        ([dmeAlive, fmNavDiscrete]) => dmeAlive && fmNavDiscrete.isNormalOperation(),
        this.dmeAlive,
        this.fm1NavDiscrete,
    );

    private readonly dmeDistanceRounded = this.dmeDistance.map((v) => MathUtils.round(v, 0.1));

    private readonly dmeTextLeading = this.dmeDistanceRounded.map((v) => (v < 20 ? Math.trunc(v).toString() : Math.round(v).toString())).pause();

    private readonly dmeTextTrailing = this.dmeDistanceRounded.map((v) => (v < 20 ? `.${Math.round((v - Math.trunc(v)) * 10).toString()}` : '')).pause();

    private readonly pausable: (ConsumerSubject<unknown> | Subscription)[] = [
        this.lsAlive,
        this.lsFrequency,
        this.lsIdent,
        this.dmeAlive,
        this.dmeDistance,
    ];

    onAfterRender(node: VNode): void {
        super.onAfterRender(node);

        const sub = this.props.bus.getSubscriber<PFDSimvars>();

        this.lsAlive.setConsumer(sub.on('hasLoc'));

        this.lsIdent.setConsumer(sub.on('navIdent'));

        this.lsFrequency.setConsumer(sub.on('navFreq'));

        this.dmeAlive.setConsumer(sub.on('hasDme'));

        this.dmeDistance.setConsumer(sub.on('dme'));

        this.pausable.push(sub.on('fm1NavDiscrete').whenChanged().handle((fm1NavDiscrete) => {
            this.fm1NavDiscrete.setWord(fm1NavDiscrete);
        }));

        this.isLsFreqHidden.sub((hidden) => {
            console.log('isLsFreqHidden', hidden, this.lsFrequency.get());
            if (hidden) {
                this.freqTextLeading.pause();
                this.freqTextTrailing.pause();
            } else {
                this.freqTextLeading.resume();
                this.freqTextTrailing.resume();
            }
        }, true);

        this.isLsIdentHidden.sub((hidden) => {
            if (hidden) {
                this.lsIdentPipe.pause();
            } else {
                this.lsIdentPipe.resume(true);
            }
        });

        this.isDmeAvailable.sub((available) => {
            if (available) {
                this.dmeTextLeading.resume();
                this.dmeTextTrailing.resume();
            } else {
                this.dmeTextLeading.pause();
                this.dmeTextTrailing.pause();
            }
        }, true);

        this.props.isVisible.sub((v) => {
            if (v) {
                this.resume();
            } else {
                this.pause();
            }
        });
    }

    public pause(): void {
        for (const sub of this.pausable) {
            sub.pause();
        }
    }

    public resume(): void {
        for (const sub of this.pausable) {
            sub.resume(true);
        }
    }

    render(): VNode {
        return (
            <g
                id="LSInfoGroup"
                class={{ HiddenElement: this.props.isVisible.map((v) => !v) }}
            >
                <text
                    id="ILSIdent"
                    class={{
                        Magenta: true,
                        FontLarge: true,
                        AlignLeft: true,
                        HiddenElement: this.isLsIdentHidden,
                    }}
                    x="1.184"
                    y="145.11522"
                >
                    {this.lsIdentText}
                </text>
                <text
                    id="ILSFreqLeading"
                    class={{
                        Magenta: true,
                        FontLarge: true,
                        AlignLeft: true,
                        HiddenElement: this.isLsFreqHidden,
                    }}
                    x="1.3610243"
                    y="151.11575"
                >
                    {this.freqTextLeading}
                </text>
                <text
                    id="ILSFreqTrailing"
                    class={{
                        Magenta: true,
                        FontSmallest: true,
                        AlignLeft: true,
                        HiddenElement: this.isLsFreqHidden,
                    }}
                    x="12.964463"
                    y="151.24084"
                >
                    {this.freqTextTrailing}
                </text>

                <g id="ILSDistGroup" class={{ HiddenElement: this.isDmeAvailable.map((v) => !v) }}>
                    <text class="Magenta AlignLeft" x="1.3685881" y="157.26602">
                        <tspan id="ILSDistLeading" class="FontLarge StartAlign">
                            {this.dmeTextLeading}
                        </tspan>
                        <tspan id="ILSDistTrailing" class="FontSmallest StartAlign">
                            {this.dmeTextTrailing}
                        </tspan>
                    </text>
                    <text class="Cyan FontSmallest AlignLeft" x="17.159119" y="157.22606">NM</text>
                </g>

            </g>
        );
    }
}

class LocalizerIndicator extends DisplayComponent<{bus: ArincEventBus, instrument: BaseInstrument}> {
    private lagFilter = new LagFilter(1.5);

    private rightDiamond = FSComponent.createRef<SVGPathElement>();

    private leftDiamond = FSComponent.createRef<SVGPathElement>();

    private locDiamond = FSComponent.createRef<SVGPathElement>();

    private diamondGroup = FSComponent.createRef<SVGGElement>();

    private handleNavRadialError(radialError: number): void {
        const deviation = this.lagFilter.step(radialError, this.props.instrument.deltaTime / 1000);
        const dots = deviation / 0.8;

        if (dots > 2) {
            this.rightDiamond.instance.classList.remove('HiddenElement');
            this.leftDiamond.instance.classList.add('HiddenElement');
            this.locDiamond.instance.classList.add('HiddenElement');
        } else if (dots < -2) {
            this.rightDiamond.instance.classList.add('HiddenElement');
            this.leftDiamond.instance.classList.remove('HiddenElement');
            this.locDiamond.instance.classList.add('HiddenElement');
        } else {
            this.locDiamond.instance.classList.remove('HiddenElement');
            this.rightDiamond.instance.classList.add('HiddenElement');
            this.leftDiamond.instance.classList.add('HiddenElement');
            this.locDiamond.instance.style.transform = `translate3d(${dots * 30.221 / 2}px, 0px, 0px)`;
        }
    }

    onAfterRender(node: VNode): void {
        super.onAfterRender(node);

        const sub = this.props.bus.getSubscriber<PFDSimvars>();

        sub.on('hasLoc').whenChanged().handle((hasLoc) => {
            if (hasLoc) {
                this.diamondGroup.instance.classList.remove('HiddenElement');
                this.props.bus.on('navRadialError', this.handleNavRadialError.bind(this));
            } else {
                this.diamondGroup.instance.classList.add('HiddenElement');
                this.lagFilter.reset();
                this.props.bus.off('navRadialError', this.handleNavRadialError.bind(this));
            }
        });
    }

    render(): VNode {
        return (
            <g id="LocalizerSymbolsGroup">
                <path class="NormalStroke White" d="m54.804 130.51a1.0073 1.0079 0 1 0-2.0147 0 1.0073 1.0079 0 1 0 2.0147 0z" />
                <path class="NormalStroke White" d="m39.693 130.51a1.0074 1.0079 0 1 0-2.0147 0 1.0074 1.0079 0 1 0 2.0147 0z" />
                <path class="NormalStroke White" d="m85.024 130.51a1.0073 1.0079 0 1 0-2.0147 0 1.0073 1.0079 0 1 0 2.0147 0z" />
                <path class="NormalStroke White" d="m100.13 130.51a1.0074 1.0079 0 1 0-2.0147 0 1.0074 1.0079 0 1 0 2.0147 0z" />
                <g class="HiddenElement" ref={this.diamondGroup}>
                    <path id="LocDiamondRight" ref={this.rightDiamond} class="NormalStroke Magenta HiddenElement" d="m99.127 133.03 3.7776-2.5198-3.7776-2.5198" />
                    <path id="LocDiamondLeft" ref={this.leftDiamond} class="NormalStroke Magenta HiddenElement" d="m38.686 133.03-3.7776-2.5198 3.7776-2.5198" />
                    <path
                        id="LocDiamond"
                        ref={this.locDiamond}
                        class="NormalStroke Magenta HiddenElement"
                        d="m65.129 130.51 3.7776 2.5198 3.7776-2.5198-3.7776-2.5198z"
                    />
                </g>
                <path id="LocalizerNeutralLine" class="Yellow Fill" d="m 68.14059,133.69116 v -6.35451 h 1.531629 v 6.35451 z" />
            </g>
        );
    }
}

class GlideSlopeIndicator extends DisplayComponent<{bus: ArincEventBus, instrument: BaseInstrument}> {
    private lagFilter = new LagFilter(1.5);

    private upperDiamond = FSComponent.createRef<SVGPathElement>();

    private lowerDiamond = FSComponent.createRef<SVGPathElement>();

    private glideSlopeDiamond = FSComponent.createRef<SVGPathElement>();

    private diamondGroup = FSComponent.createRef<SVGGElement>();

    private hasGlideSlope = false;

    private handleGlideSlopeError(glideSlopeError: number): void {
        const deviation = this.lagFilter.step(glideSlopeError, this.props.instrument.deltaTime / 1000);
        const dots = deviation / 0.4;

        if (dots > 2) {
            this.upperDiamond.instance.classList.remove('HiddenElement');
            this.lowerDiamond.instance.classList.add('HiddenElement');
            this.glideSlopeDiamond.instance.classList.add('HiddenElement');
        } else if (dots < -2) {
            this.upperDiamond.instance.classList.add('HiddenElement');
            this.lowerDiamond.instance.classList.remove('HiddenElement');
            this.glideSlopeDiamond.instance.classList.add('HiddenElement');
        } else {
            this.upperDiamond.instance.classList.add('HiddenElement');
            this.lowerDiamond.instance.classList.add('HiddenElement');
            this.glideSlopeDiamond.instance.classList.remove('HiddenElement');
            this.glideSlopeDiamond.instance.style.transform = `translate3d(0px, ${dots * 30.238 / 2}px, 0px)`;
        }
    }

    onAfterRender(node: VNode): void {
        super.onAfterRender(node);

        const sub = this.props.bus.getSubscriber<PFDSimvars>();

        sub.on('hasGlideslope').whenChanged().handle((hasGlideSlope) => {
            this.hasGlideSlope = hasGlideSlope;
            if (hasGlideSlope) {
                this.diamondGroup.instance.classList.remove('HiddenElement');
            } else {
                this.diamondGroup.instance.classList.add('HiddenElement');
                this.lagFilter.reset();
            }
        });

        sub.on('glideSlopeError').handle((gs) => {
            if (this.hasGlideSlope) {
                this.handleGlideSlopeError(gs);
            }
        });
    }

    render(): VNode {
        return (
            <g id="LocalizerSymbolsGroup">
                <path class="NormalStroke White" d="m110.71 50.585a1.0074 1.0079 0 1 0-2.0147 0 1.0074 1.0079 0 1 0 2.0147 0z" />
                <path class="NormalStroke White" d="m110.71 65.704a1.0074 1.0079 0 1 0-2.0147 0 1.0074 1.0079 0 1 0 2.0147 0z" />
                <path class="NormalStroke White" d="m110.71 95.942a1.0074 1.0079 0 1 0-2.0147 0 1.0074 1.0079 0 1 0 2.0147 0z" />
                <path class="NormalStroke White" d="m110.71 111.06a1.0074 1.0079 0 1 0-2.0147 0 1.0074 1.0079 0 1 0 2.0147 0z" />
                <g class="HideGSDiamond" ref={this.diamondGroup}>
                    <path id="GlideSlopeDiamondLower" ref={this.upperDiamond} class="NormalStroke Magenta HiddenElement" d="m107.19 111.06 2.5184 3.7798 2.5184-3.7798" />
                    <path id="GlideSlopeDiamondUpper" ref={this.lowerDiamond} class="NormalStroke Magenta HiddenElement" d="m107.19 50.585 2.5184-3.7798 2.5184 3.7798" />
                    <path
                        id="GlideSlopeDiamond"
                        ref={this.glideSlopeDiamond}
                        class="NormalStroke Magenta HiddenElement"
                        d="m109.7 77.043-2.5184 3.7798 2.5184 3.7798 2.5184-3.7798z"
                    />
                </g>
            </g>
        );
    }
}

class VDevIndicator extends DisplayComponent<{bus: ArincEventBus}> {
    private VDevSymbolLower = FSComponent.createRef<SVGPathElement>();

    private VDevSymbolUpper = FSComponent.createRef<SVGPathElement>();

    private VDevSymbol = FSComponent.createRef<SVGPathElement>();

    onAfterRender(node: VNode): void {
        super.onAfterRender(node);

        // TODO use correct simvar once RNAV is implemented
        const deviation = 0;
        const dots = deviation / 100;

        if (dots > 2) {
            this.VDevSymbolLower.instance.style.visibility = 'visible';
            this.VDevSymbolUpper.instance.style.visibility = 'hidden';
            this.VDevSymbol.instance.style.visibility = 'hidden';
        } else if (dots < -2) {
            this.VDevSymbolLower.instance.style.visibility = 'hidden';
            this.VDevSymbolUpper.instance.style.visibility = 'visible';
            this.VDevSymbol.instance.style.visibility = 'hidden';
        } else {
            this.VDevSymbolLower.instance.style.visibility = 'hidden';
            this.VDevSymbolUpper.instance.style.visibility = 'hidden';
            this.VDevSymbol.instance.style.visibility = 'visible';
            this.VDevSymbol.instance.style.transform = `translate3d(0px, ${dots * 30.238 / 2}px, 0px)`;
        }
    }

    render(): VNode {
        return (
            <g id="VertDevSymbolsGroup">
                <text class="FontSmallest AlignRight Green" x="96.410" y="46.145">V/DEV</text>
                <path class="NormalStroke White" d="m108.7 65.704h2.0147" />
                <path class="NormalStroke White" d="m108.7 50.585h2.0147" />
                <path class="NormalStroke White" d="m108.7 111.06h2.0147" />
                <path class="NormalStroke White" d="m108.7 95.942h2.0147" />
                <path id="VDevSymbolLower" ref={this.VDevSymbolLower} class="NormalStroke Green" d="m 106.58482,111.06072 v 2.00569 h 6.2384 v -2.00569" />
                <path id="VDevSymbolUpper" ref={this.VDevSymbolUpper} class="NormalStroke Green" d="m 106.58482,50.584541 v -2.005689 h 6.2384 v 2.005689" />
                <path id="VDevSymbol" ref={this.VDevSymbol} class="NormalStroke Green" d="m 112.83172,78.62553 h -6.25541 v 2.197103 2.197106 h 6.25541 v -2.197106 z" />
            </g>
        );
    }
}

class LDevIndicator extends DisplayComponent<{bus: ArincEventBus}> {
    private LDevSymbolLeft = FSComponent.createRef<SVGPathElement>();

    private LDevSymbolRight = FSComponent.createRef<SVGPathElement>();

    private LDevSymbol = FSComponent.createRef<SVGPathElement>();

    onAfterRender(node: VNode): void {
        super.onAfterRender(node);

        const sub = this.props.bus.getSubscriber<PFDSimvars>();

        sub.on('xtk').whenChanged().withPrecision(3).handle((xtk) => {
            const dots = xtk / 0.1;

            if (dots > 2) {
                this.LDevSymbolRight.instance.style.visibility = 'visible';
                this.LDevSymbolLeft.instance.style.visibility = 'hidden';
                this.LDevSymbol.instance.style.visibility = 'hidden';
            } else if (dots < -2) {
                this.LDevSymbolRight.instance.style.visibility = 'hidden';
                this.LDevSymbolLeft.instance.style.visibility = 'visible';
                this.LDevSymbol.instance.style.visibility = 'hidden';
            } else {
                this.LDevSymbolRight.instance.style.visibility = 'hidden';
                this.LDevSymbolLeft.instance.style.visibility = 'hidden';
                this.LDevSymbol.instance.style.visibility = 'visible';
                this.LDevSymbol.instance.style.transform = `translate3d(${dots * 30.238 / 2}px, 0px, 0px)`;
            }
        });
    }

    render(): VNode {
        return (
            <g id="LatDeviationSymbolsGroup">
                <text class="FontSmallest AlignRight Green" x="31.578" y="125.392">L/DEV</text>
                <path class="NormalStroke White" d="m38.686 129.51v2.0158" />
                <path class="NormalStroke White" d="m53.796 129.51v2.0158" />
                <path class="NormalStroke White" d="m84.017 129.51v2.0158" />
                <path class="NormalStroke White" d="m99.127 129.51v2.0158" />
                <path id="LDevSymbolLeft" ref={this.LDevSymbolLeft} class="NormalStroke Green" d="m 38.68595,127.35727 h -2.003935 v 6.31326 h 2.003935" />
                <path id="LDevSymbolRight" ref={this.LDevSymbolRight} class="NormalStroke Green" d="m 99.126865,127.35727 h 2.003925 v 6.31326 h -2.003925" />
                <path id="LDevSymbol" ref={this.LDevSymbol} class="NormalStroke Green" d="m 66.693251,127.36221 v 6.30339 h 2.213153 2.213153 v -6.30339 h -2.213153 z" />
                <path id="LDevNeutralLine" class="Yellow Fill" d="m 68.14059,133.69116 v -6.35451 h 1.531629 v 6.35451 z" />
            </g>
        );
    }
}

class MarkerBeaconIndicator extends DisplayComponent<{ bus: ArincEventBus }> {
    private classNames = Subject.create('HiddenElement');

    private markerText = Subject.create('');

    onAfterRender(node: VNode): void {
        super.onAfterRender(node);

        const sub = this.props.bus.getSubscriber<PFDSimvars>();

        const baseClass = 'FontLarge StartAlign';

        sub.on('markerBeacon').whenChanged().handle((markerState) => {
            if (markerState === 0) {
                this.classNames.set(`${baseClass} HiddenElement`);
            } else if (markerState === 1) {
                this.classNames.set(`${baseClass} Cyan OuterMarkerBlink`);
                this.markerText.set('OM');
            } else if (markerState === 2) {
                this.classNames.set(`${baseClass} Amber MiddleMarkerBlink`);
                this.markerText.set('MM');
            } else {
                this.classNames.set(`${baseClass} White InnerMarkerBlink`);
                this.markerText.set('IM');
            }
        });
    }

    render(): VNode {
        return (
            <text id="ILSMarkerText" class={this.classNames} x="98.339211" y="125.12898">{this.markerText}</text>
        );
    }
}
