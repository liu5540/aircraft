// Copyright (c) 2021-2023 FlyByWire Simulations
//
// SPDX-License-Identifier: GPL-3.0

import React, { useEffect, useState } from 'react';
import { useSimVar } from '@flybywiresim/fbw-sdk';
import { EfisNdMode, EfisSide, NavAidMode } from '@shared/NavigationDisplay';

type RadioNavPointerProps = { index: 1 | 2, side: EfisSide, displayMode: EfisNdMode, centreHeight: number, trueRef: boolean };

const AdfNeedle: React.FC<Omit<RadioNavPointerProps, 'side'>> = ({ index, displayMode, centreHeight }) => {
    const [relativeBearing] = useSimVar(`ADF RADIAL:${index}`, 'degrees');
    const [available] = useSimVar(`ADF SIGNAL:${index}`, 'number');

    let paths: Array<string>;

    switch (displayMode) {
    case EfisNdMode.ARC:
        paths = [
            'M384,251 L384,128 M370,179 L384,155 L398,179 M384,1112 L384,989 M370,1085 L384,1061 L398,1085',
            'M370,251 L370,219 L384,195 L398,219 L398,251 M384,195 L384,128 M384,1112 L384,1023 M370,989 L370,1040 L384,1023 L398,1040 L398,989',
        ];
        break;
    case EfisNdMode.ROSE_ILS:
    case EfisNdMode.ROSE_VOR:
    case EfisNdMode.ROSE_NAV:
        paths = [
            'M384,257 L384,134 M370,185 L384,161 L398,185 M384,634 L384,511 M370,607 L384,583 L398,607',
            'M370,257 L370,225 L384,201 L398,225 L398,257 M384,201 L384,134 M384,634 L384,545 M370,511 L370,562 L384,545 L398,562 L398,511',
        ];
        break;
    default:
        console.error(`RadioNeedle: invalid display mode: ${displayMode}`);
        return null;
    }

    return available && (
        <g transform={`rotate(${relativeBearing} 384 ${centreHeight})`}>
            <path
                d={paths[index - 1]}
                strokeWidth={3.7}
                className="rounded shadow"
            />
            <path
                d={paths[index - 1]}
                strokeWidth={3.2}
                className="rounded Green"
            />
        </g>
    );
};

const VorNeedle: React.FC<Omit<RadioNavPointerProps, 'side'>> = ({ index, displayMode, centreHeight, trueRef }) => {
    const [relativeBearing] = useSimVar(`NAV RELATIVE BEARING TO STATION:${index}`, 'degrees');
    const [available] = useSimVar(`NAV HAS NAV:${index}`, 'number');
    const [isLoc] = useSimVar(`NAV HAS LOCALIZER:${index}`, 'number');
    const [stationDeclination] = useSimVar(`NAV MAGVAR:${index}`, 'degrees');
    const [stationLocation] = useSimVar(`NAV VOR LATLONALT:${index}`, 'latlonalt');
    const [stationRefTrue, setStationRefTrue] = useState(false);

    useEffect(() => {
        setStationRefTrue(stationLocation.lat > 75 && stationDeclination < Number.EPSILON);
    }, [stationDeclination, stationLocation.lat]);

    let paths: Array<string>;

    switch (displayMode) {
    case EfisNdMode.ARC:
        paths = [
            'M384,251 L384,179 M384,128 L384,155 L370,179 L398,179 L384,155 M384,1112 L384,1085 M384,989 L384,1061 L370,1085 L398,1085 L384,1061',
            'M377,251 L377,219 L370,219 L384,195 L398,219 L391,219 L391,251 M384,195 L384,128 M384,1112 L384,1045 M377,989 L377,1045 L391,1045 L391,989',
        ];
        break;
    case EfisNdMode.ROSE_ILS:
    case EfisNdMode.ROSE_VOR:
    case EfisNdMode.ROSE_NAV:
        paths = [
            'M384,257 L384,185 M384,134 L384,161 L370,185 L398,185 L384,161 M384,634 L384,607 M384,511 L384,583 L370,607 L398,607 L384,583',
            'M377,257 L377,225 L370,225 L384,201 L398,225 L391,225 L391,256 M384,201 L384,134 M384,634 L384,567 M377,511 L377,567 L391,567 L391,511',
        ];
        break;
    default:
        console.error(`RadioNeedle: invalid display mode: ${displayMode}`);
        return null;
    }

    // FIXME pointers should never be correct in ROSE VOR/LS... easier when VOR/MKR LRU is implemented

    return available && !isLoc && (
        <g transform={`rotate(${relativeBearing} 384 ${centreHeight})`}>
            <path
                d={paths[index - 1]}
                strokeWidth={3.7}
                className="rounded shadow"
            />
            <path
                d={paths[index - 1]}
                strokeWidth={3.2}
                className={`rounded ${!!(trueRef) !== stationRefTrue ? 'Magenta' : 'White'}`}
            />
        </g>
    );
};

export const RadioNeedle: React.FC<RadioNavPointerProps> = ({ index, side, displayMode, centreHeight, trueRef }) => {
    const [mode] = useSimVar(`L:A32NX_EFIS_${side}_NAVAID_${index}_MODE`, 'enum');

    switch (mode) {
    case NavAidMode.ADF:
        return <AdfNeedle index={index} displayMode={displayMode} centreHeight={centreHeight} trueRef={trueRef} />;
    case NavAidMode.VOR:
        return <VorNeedle index={index} displayMode={displayMode} centreHeight={centreHeight} trueRef={trueRef} />;
    case NavAidMode.Off:
    default:
        return null;
    }
};
