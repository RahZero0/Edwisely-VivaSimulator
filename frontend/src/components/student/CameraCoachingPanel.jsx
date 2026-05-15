import React, { useEffect, useRef, useState } from "react";
import {
  disposeBodyLanguageAnalyzer,
  getCurrentBodyLanguageSnapshot,
  initBodyLanguageAnalyzer,
  startBodyLanguageTracking,
  stopBodyLanguageTracking,
} from "../../lib/bodyLanguageAnalyzer.js";

export default function CameraCoachingPanel({ enabled, onEnabledChange }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const analyzerRef = useRef(null);
  const [snapshot, setSnapshot] = useState(getCurrentBodyLanguageSnapshot());
  const [status, setStatus] = useState("");

  useEffect(() => {
    let snapshotTimer;
    if (enabled) {
      startCamera().then(() => {
        snapshotTimer = window.setInterval(() => {
          setSnapshot(getCurrentBodyLanguageSnapshot());
        }, 1000);
      });
    }

    return () => {
      if (snapshotTimer) window.clearInterval(snapshotTimer);
      stopCamera();
    };
  }, [enabled]);

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Camera coaching is not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        analyzerRef.current = await initBodyLanguageAnalyzer(videoRef.current);
        startBodyLanguageTracking();
        setStatus("Camera coaching is running locally.");
      }
    } catch (error) {
      setStatus(`Camera permission denied or unavailable: ${error.message}`);
      onEnabledChange(false);
    }
  }

  function stopCamera() {
    stopBodyLanguageTracking();
    disposeBodyLanguageAnalyzer();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function calibrate() {
    analyzerRef.current?.calibrate();
    setStatus("Neutral posture calibrated.");
  }

  return (
    <div className="cameraPanel">
      <div className="cameraHeader">
        <label className="inlineToggle">
          <input type="checkbox" checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} />
          Camera Coaching
        </label>
        {enabled && <button className="secondaryButton" onClick={calibrate}>Calibrate posture</button>}
      </div>
      <p className="privacyNote">Camera coaching runs locally and is used only for communication feedback.</p>
      {enabled && (
        <>
          <video ref={videoRef} className="cameraPreview" muted playsInline />
          <div className="coachBadges">
            <span className={snapshot.faceVisible ? "goodBadge" : "warnBadge"}>Face visible</span>
            <span className={snapshot.facingCamera ? "goodBadge" : "warnBadge"}>Facing camera</span>
            <span className={snapshot.postureOkay ? "goodBadge" : "warnBadge"}>Posture okay</span>
          </div>
        </>
      )}
      {status && <p className="muted">{status}</p>}
    </div>
  );
}
