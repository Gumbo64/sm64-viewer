import React, { useEffect, useRef, useContext, useState } from 'react';

import { GameConfig, RngConfig, sm64_playback } from "sm64-binds-frontend";
import { BlockchainContext } from '../context/BlockchainContext';
import { sm64_evaluate } from "sm64-binds-frontend";

function BlockWindow({ solution }) {  
    const canvasRef = useRef(null);
    const [playing, setPlaying] = useState(false);

    if (solution == null) {
        return (
            <h1>Null solution</h1>
        )
    }

    async function play_solution() {
        if (!playing) {
            let seed = NaN;
            let game_config = new GameConfig(NaN, null);
            setPlaying(true);
            await sm64_playback(canvasRef.current, solution, false, seed, game_config, 2, 2);
            setPlaying(false);
        }
    }

    return (
        <div>
            <ul>
                <li>Solution length: {solution.length}</li>
                <li><button onClick={play_solution}>Play solution</button></li>
                <li>
                    <div id="container">
                        <canvas ref={canvasRef} className="sm64canvas_small" id={playing && "canvas"}></canvas>
                    </div>
                </li>
            </ul>
        </div>
    );
}

export default BlockWindow;
