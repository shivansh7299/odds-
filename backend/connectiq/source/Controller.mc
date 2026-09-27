import Toybox.ActivityMonitor;
import Toybox.Application;
import Toybox.Background;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.Sensor;
import Toybox.System;
import Toybox.Time;
import Toybox.Timer;
import Toybox.WatchUi;

//! Foreground logic: pairing (device-code flow) and 1 Hz streaming while the app is open.
class Controller {
    enum State {
        UNPAIRED,
        STARTING,
        SHOWING_CODE,
        STREAMING
    }

    const UPLOAD_EVERY_MS = 10000;
    const MAX_BUFFER = 600; // ~10 min of 1 Hz readings if the phone is out of range

    var state as State = UNPAIRED;
    var userCode as String? = null;
    var message as String = "";
    var bpm as Number? = null;
    var sent as Number = 0;

    private var _autoStarted as Boolean = false;
    private var _deviceCode as String? = null;
    private var _pollTimer as Timer.Timer?;
    private var _pollMs as Number = 5000;
    private var _uploadTimer as Timer.Timer?;
    private var _inFlight as Boolean = false;
    private var _hr as Array<Array<Number>> = [] as Array<Array<Number>>;
    private var _rr as Array<Dictionary> = [] as Array<Dictionary>;
    private var _sendingHr as Array<Array<Number>> = [] as Array<Array<Number>>;
    private var _sendingRr as Array<Dictionary> = [] as Array<Dictionary>;

    function initialize() {
        if (Config.token() != null) {
            startStreaming();
        } else {
            message = "Press START to pair";
        }
    }

    // ── Pairing ──────────────────────────────────────────────────────────────

    //! Called when the main screen appears: pair automatically the first time.
    function onShow() as Void {
        if (state == UNPAIRED && !_autoStarted) {
            _autoStarted = true;
            startPairing();
        }
    }

    function startPairing() as Void {
        System.println("[vitalsync] pair/start -> " + Config.serverUrl());
        if (Config.serverUrl().find("https://") != 0) {
            message = "Set Server URL in Garmin Connect app settings";
            WatchUi.requestUpdate();
            return;
        }
        state = STARTING;
        message = "Contacting server...";
        WatchUi.requestUpdate();
        Communications.makeWebRequest(
            Config.serverUrl() + "/api/devices/pair/start",
            { "name" => "Forerunner", "model" => Config.deviceModel() },
            Config.jsonOptions(null),
            method(:onPairStart)
        );
    }

    function onPairStart(code as Number, data as Dictionary or String or Null) as Void {
        System.println("[vitalsync] pair/start <- " + code);
        if (code == 201 && data instanceof Dictionary) {
            _deviceCode = data["deviceCode"] as String;
            userCode = data["userCode"] as String;
            var interval = data["interval"];
            _pollMs = (interval instanceof Number ? interval : 5) * 1000;
            state = SHOWING_CODE;
            message = "Enter code on Sources page";
            _pollTimer = new Timer.Timer();
            _pollTimer.start(method(:poll), _pollMs, true);
        } else {
            state = UNPAIRED;
            message = describeError(code);
        }
        WatchUi.requestUpdate();
    }

    function poll() as Void {
        var code = _deviceCode;
        if (code == null) {
            return;
        }
        Communications.makeWebRequest(
            Config.serverUrl() + "/api/devices/pair/poll",
            { "deviceCode" => code },
            Config.jsonOptions(null),
            method(:onPoll)
        );
    }

    function onPoll(code as Number, data as Dictionary or String or Null) as Void {
        System.println("[vitalsync] pair/poll <- " + code);
        if (code == 200 && data instanceof Dictionary) {
            stopPolling();
            Application.Storage.setValue(Config.TOKEN_KEY, data["token"] as String);
            scheduleBackground();
            startStreaming();
        } else if (code == 202 || code == 429) {
            return; // still waiting (or asked to slow down); keep polling
        } else if (code == 410) {
            stopPolling();
            state = UNPAIRED;
            message = "Code expired. Press START";
        } else if (code < 0) {
            message = describeError(code); // phone unreachable; keep trying
        }
        WatchUi.requestUpdate();
    }

    private function stopPolling() as Void {
        if (_pollTimer != null) {
            _pollTimer.stop();
            _pollTimer = null;
        }
        _deviceCode = null;
        userCode = null;
    }

    function unpair() as Void {
        stopStreaming();
        stopPolling();
        Application.Storage.deleteValue(Config.TOKEN_KEY);
        if (Toybox has :Background) {
            Background.deleteTemporalEvent();
        }
        state = UNPAIRED;
        message = "Unpaired. Press START to pair";
        WatchUi.requestUpdate();
    }

    // ── Streaming ────────────────────────────────────────────────────────────

    function startStreaming() as Void {
        state = STREAMING;
        message = "Starting sensor...";
        Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE]);
        Sensor.enableSensorEvents(method(:onSensor));
        if (Sensor has :registerSensorDataListener) {
            Sensor.registerSensorDataListener(method(:onSensorData), {
                :period => 1,
                :heartBeatIntervals => { :enabled => true }
            });
        }
        _uploadTimer = new Timer.Timer();
        _uploadTimer.start(method(:upload), UPLOAD_EVERY_MS, true);
    }

    function stopStreaming() as Void {
        if (_uploadTimer != null) {
            _uploadTimer.stop();
            _uploadTimer = null;
        }
        Sensor.enableSensorEvents(null);
        if (Sensor has :unregisterSensorDataListener) {
            Sensor.unregisterSensorDataListener();
        }
    }

    function onSensor(info as Sensor.Info) as Void {
        var hr = info.heartRate;
        if (hr != null && hr > 0) {
            bpm = hr;
            _hr.add([Time.now().value(), hr]);
            if (_hr.size() > MAX_BUFFER) {
                _hr = _hr.slice(_hr.size() - MAX_BUFFER, null);
            }
            WatchUi.requestUpdate();
        }
    }

    function onSensorData(data as Sensor.SensorData) as Void {
        var hrData = data.heartRateData;
        if (hrData == null) {
            return;
        }
        var intervals = hrData.heartBeatIntervals;
        if (intervals == null || intervals.size() == 0) {
            return;
        }
        var totalMs = 0;
        for (var i = 0; i < intervals.size(); i++) {
            totalMs += intervals[i];
        }
        _rr.add({ "t" => Time.now().value() - totalMs / 1000, "ms" => intervals });
        if (_rr.size() > MAX_BUFFER) {
            _rr = _rr.slice(_rr.size() - MAX_BUFFER, null);
        }
    }

    function upload() as Void {
        var token = Config.token();
        if (_inFlight || token == null || (_hr.size() == 0 && _rr.size() == 0)) {
            return;
        }
        _inFlight = true;
        _sendingHr = _hr;
        _sendingRr = _rr;
        _hr = [] as Array<Array<Number>>;
        _rr = [] as Array<Dictionary>;
        var payload = {
            "model" => Config.deviceModel(),
            "live" => { "hr" => _sendingHr, "rr" => _sendingRr },
            "steps" => { "t" => Time.now().value(), "total" => ActivityMonitor.getInfo().steps }
        };
        Communications.makeWebRequest(
            Config.serverUrl() + "/api/ingest/connectiq",
            payload,
            Config.jsonOptions(token),
            method(:onUpload)
        );
    }

    function onUpload(code as Number, data as Dictionary or String or Null) as Void {
        System.println("[vitalsync] ingest <- " + code + " (" + _sendingHr.size() + " hr)");
        _inFlight = false;
        if (code == 200) {
            sent += _sendingHr.size();
            message = "Synced";
        } else if (code == 401) {
            unpair();
            message = "Disconnected on dashboard. Pair again";
        } else {
            // Keep the data: put it back in front of anything collected meanwhile.
            _hr = _sendingHr.addAll(_hr);
            _rr = _sendingRr.addAll(_rr);
            if (_hr.size() > MAX_BUFFER) {
                _hr = _hr.slice(_hr.size() - MAX_BUFFER, null);
            }
            if (_rr.size() > MAX_BUFFER) {
                _rr = _rr.slice(_rr.size() - MAX_BUFFER, null);
            }
            message = describeError(code);
        }
        _sendingHr = [] as Array<Array<Number>>;
        _sendingRr = [] as Array<Dictionary>;
        WatchUi.requestUpdate();
    }

    function describeError(code as Number) as String {
        if (code == Communications.BLE_CONNECTION_UNAVAILABLE) {
            return "Phone not connected";
        } else if (code == Communications.NETWORK_REQUEST_TIMED_OUT) {
            return "Server timed out";
        } else if (code == 429) {
            return "Rate limited, retrying";
        } else if (code == 409) {
            return "Source paused on dashboard";
        } else if (code >= 500) {
            return "Server error " + code;
        }
        return "Error " + code;
    }
}
