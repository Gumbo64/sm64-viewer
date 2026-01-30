import React, { useEffect, useRef, useContext, useState } from 'react';

import { GameConfig, RngConfig, sm64_playback } from "sm64-binds-frontend";
import { BlockchainContext } from '../context/BlockchainContext';
import { sm64_evaluate } from "sm64-binds-frontend";

function BlockWindow({ solution }) {  
    const canvasRef = useRef(null);
    const [playing, setPlaying] = useState(false);
    const [speed, setSpeed] = useState(1); // <-- new state
    const [splitIndex, setSplitIndex] = useState(0); // <-- Added state for splitting
    if (solution == null) {
        return <h1>Null solution</h1>;
    }

    async function play_solution() {
        if (!playing) {
            let seed = NaN;
            let game_config = new GameConfig(NaN, null);
            console.log(solution.length)
            setPlaying(true);

            const firstPart = solution.slice(0, splitIndex);
            const secondPart = solution.slice(splitIndex);

            let [engine, _] = await sm64_playback(
                canvasRef.current,
                firstPart,
                false,
                seed,
                game_config,
                200,
                200
            );
            await sm64_playback(
                canvasRef.current,
                secondPart,
                false,
                seed,
                game_config,
                speed,
                speed,
                async () => false,
                () => false,
                engine
            );
            setPlaying(false);
        }
    }

    return (
        <div>
            <ul>
                <li>Solution length: {solution.length}</li>
                <li>
                    Start from index (wait for it to load):&nbsp;
                    <input
                        type="number"
                        value={splitIndex}
                        min={0}
                        max={solution.length}
                        onChange={(e) => setSplitIndex(Number(e.target.value))}
                    />
                </li>
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
