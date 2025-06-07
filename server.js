const WebSocket = require("ws");
const http = require("http");

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const doctors = new Map(); // doctorId -> { status, lastActivity, ws }

// Inactivity timeout (5 minutes)
const INACTIVITY_TIMEOUT = 5 * 60 * 1000;

// Check for inactive doctors
setInterval(() => {
  const now = Date.now();
  doctors.forEach((doctor, doctorId) => {
    if (
      doctor.status === "active" &&
      now - doctor.lastActivity > INACTIVITY_TIMEOUT
    ) {
      console.log(`Doctor ${doctorId} marked as away due to inactivity`);
      doctor.status = "away";
      broadcastStatusUpdate(doctorId, "away");
      notifyDoctor(doctorId, {
        type: "auto_status_change",
        newStatus: "away",
        reason: "inactivity",
      });
    }
  });
}, 60000); // Check every minute

function broadcastStatusUpdate(doctorId, newStatus) {
  const message = {
    type: "doctor_status_update",
    doctorId,
    status: newStatus,
    timestamp: new Date().toISOString(),
  };

  console.log(`Broadcasting status update for ${doctorId}: ${newStatus}`);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

function notifyDoctor(doctorId, message) {
  const doctor = doctors.get(doctorId);
  if (doctor && doctor.ws.readyState === WebSocket.OPEN) {
    console.log(`Notifying doctor ${doctorId}:`, message);
    doctor.ws.send(JSON.stringify(message));
  }
}

wss.on("connection", (ws) => {
  console.log("New client connected");

  // Send current status of all doctors to new client
  doctors.forEach((doctor, doctorId) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "doctor_status_update",
          doctorId,
          status: doctor.status,
          timestamp: new Date().toISOString(),
        })
      );
    }
  });

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      console.log("Received message:", data);

      if (data.type === "doctor_auth") {
        // Doctor login
        doctors.set(data.doctorId, {
          status: data.status || "active",
          lastActivity: Date.now(),
          ws,
        });

        console.log(`Doctor ${data.doctorId} authenticated`);

        ws.send(
          JSON.stringify({
            type: "auth_confirmation",
            status: "success",
            currentStatus: "active",
          })
        );

        broadcastStatusUpdate(data.doctorId, "active");
      } else if (data.type === "status_change") {
        // Manual status change
        const doctor = doctors.get(data.doctorId);
        if (doctor) {
          doctor.status = data.newStatus;
          doctor.lastActivity = Date.now();

          console.log(
            `Doctor ${data.doctorId} status changed to ${data.newStatus}`
          );

          ws.send(
            JSON.stringify({
              type: "status_change_ack",
              status: "success",
              newStatus: data.newStatus,
            })
          );

          broadcastStatusUpdate(data.doctorId, data.newStatus);
        }
      } else if (data.type === "activity_ping") {
        // Activity ping from doctor
        const doctor = doctors.get(data.doctorId);
        if (doctor) {
          doctor.lastActivity = Date.now();
          if (doctor.status === "away") {
            doctor.status = "active";
            console.log(`Doctor ${data.doctorId} returned from away status`);
            broadcastStatusUpdate(data.doctorId, "active");
          }
        }
      } else if (data.type === "doctor_logout") {
        // Doctor logout
        doctors.delete(data.doctorId);
        console.log(`Doctor ${data.doctorId} logged out`);
        ws.send(
          JSON.stringify({
            type: "logout_confirmation",
            status: "success",
          })
        );
        broadcastStatusUpdate(data.doctorId, "offline");
      }
    } catch (err) {
      console.error("Error processing message:", err);
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    // Find and mark doctor as offline if connection closed
    doctors.forEach((doctor, doctorId) => {
      if (doctor.ws === ws) {
        console.log(`Doctor ${doctorId} disconnected`);
        doctors.delete(doctorId);
        broadcastStatusUpdate(doctorId, "offline");
      }
    });
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ws://0.0.0.0:${PORT}`);
});
