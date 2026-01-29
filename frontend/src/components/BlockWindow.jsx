import React, { useEffect, useRef, useContext, useState } from 'react';

import { GameConfig, RngConfig, sm64_playback } from "sm64-binds-frontend";
import { BlockchainContext } from '../context/BlockchainContext';
import { sm64_evaluate } from "sm64-binds-frontend";

function BlockWindow({ solution }) {  
    const canvasRef = useRef(null);
    const [playing, setPlaying] = useState(false);
    const [speed, setSpeed] = useState(1); // <-- new state

    if (solution == null) {
        return <h1>Null solution</h1>;
    }

    async function play_solution() {
        if (!playing) {
            let seed = NaN;
            let game_config = new GameConfig(NaN, null);
            setPlaying(true);
            await sm64_playback(
                canvasRef.current,
                solution,
                false,
                seed,
                game_config,
                speed,
                speed
            );
            setPlaying(false);
        }
    }

    return (
        <div>
            <ul>
                <li>Solution length: {solution.length}</li>

                <li>
                    Speed (1x speed to unmute):&nbsp;
                    <input
                        type="number"
                        value={speed}
                        min={1}
                        step={1}
                        onChange={(e) => setSpeed(Number(e.target.value))}
                    />
                </li>

                <li>
                    <button onClick={play_solution}>Play solution</button>
                </li>
            </ul>

            <div id="container">
                <canvas
                    ref={canvasRef}
                    className="sm64canvas"
                    id={playing && "canvas"}
                />
            </div>
        </div>
    );
}

export default BlockWindow;
