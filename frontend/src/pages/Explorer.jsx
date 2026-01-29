import { useState } from "react";
import BlockWindow from "../components/BlockWindow";
import './Mine.css';

class GamePad {
	constructor(button = 0, stick_x = 0, stick_y = 0) {
		this.button = button;
		this.stick_x = stick_x;
		this.stick_y = stick_y;
	}
}

function parseGamePads(bytes) {
	const pads = [];

	for (let i = 0; i + 3 < bytes.length; i += 4) {
		pads.push(gamePadFromBytes(bytes, i));
	}

	return pads;
}

function gamePadFromBytes(b, offset = 0) {
	const button = (b[offset] << 8) | b[offset + 1];

	// signed int8 conversion
	const stick_x = (b[offset + 2] << 24) >> 24;
	const stick_y = (b[offset + 3] << 24) >> 24;

	return new GamePad(button, stick_x, stick_y);
}

function Explorer() {
	const [solution, setSolution] = useState(null);
	const [removeHeader, setRemoveHeader] = useState(false); // State for the tick box

	const handleFileUpload = async (e) => {
		const file = e.target.files[0];
		if (!file) return;

		const buffer = await file.arrayBuffer();
		const bytes = new Uint8Array(buffer);

		// Remove the first 0x400 bytes if the tick box is checked
		const processedBytes = removeHeader ? bytes.slice(0x400) : bytes;

		const pads = parseGamePads(processedBytes);

		setSolution(pads);
	};

	return (
		<>
			<input
				type="file"
				accept=".m64"
				onChange={handleFileUpload}
			/>

			<label>
				<input
					type="checkbox"
					checked={removeHeader}
					onChange={(e) => setRemoveHeader(e.target.checked)}
				/>
				Remove first 0x400 bytes (fixes some replays)
			</label>

			{solution ? (
				<>
					<h2>File loaded</h2>
					<p>Bytes length: {solution.length}</p>
					<BlockWindow solution={solution} />
				</>
			) : (
				<h1>No replay loaded</h1>
			)}
		</>
	);
}

export default Explorer;
