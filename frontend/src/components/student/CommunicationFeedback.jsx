import React from "react";

export default function CommunicationFeedback({ communication }) {
  if (!communication) return null;

  return (
    <div className="communicationBox">
      <h3>Communication coaching</h3>
      <div className="rubric">
        <span>Communication: {communication.communicationScore}/5</span>
        <span>Visible: {communication.faceVisiblePercent}%</span>
        <span>Facing camera: {communication.cameraAttentionPercent}%</span>
        <span>Posture: {communication.postureScore}%</span>
      </div>
      <ul>
        {communication.feedback?.map((item, index) => (
          <li key={`${item}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
