import Toybox.ActivityMonitor;
import Toybox.Background;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.SensorHistory;
import Toybox.System;
import Toybox.Time;

//! Runs every 5 minutes even when the app is closed: sends the last 10 minutes of
//! heart-rate history, the last hour of Pulse Ox readings, and today's step total.
(:background)
class BackgroundService extends System.ServiceDelegate {
    function initialize() {
        ServiceDelegate.initialize();
    }

    function onTemporalEvent() as Void {
        var token = Config.token();
        var url = Config.serverUrl();
        if (token == null || url.length() == 0) {
            Background.exit(null);
            return;
        }
        var payload = {
            "model" => Config.deviceModel(),
            "hr" => history(:hr, new Time.Duration(10 * 60)),
            "spo2" => history(:spo2, new Time.Duration(60 * 60)),
            "steps" => { "t" => Time.now().value(), "total" => ActivityMonitor.getInfo().steps }
        };
        Communications.makeWebRequest(url + "/api/ingest/connectiq", payload, Config.jsonOptions(token), method(:onResponse));
    }

    function onResponse(code as Number, data as Dictionary or String or Null) as Void {
        Background.exit({ "code" => code, "t" => Time.now().value() });
    }

    private function history(kind as Symbol, period as Time.Duration) as Array<Array<Number>> {
        var out = [] as Array<Array<Number>>;
        if (!(Toybox has :SensorHistory)) {
            return out;
        }
        var iter = null;
        var options = { :period => period, :order => SensorHistory.ORDER_OLDEST_FIRST };
        if (kind == :hr && SensorHistory has :getHeartRateHistory) {
            iter = SensorHistory.getHeartRateHistory(options);
        } else if (kind == :spo2 && SensorHistory has :getOxygenSaturationHistory) {
            iter = SensorHistory.getOxygenSaturationHistory(options);
        }
        if (iter == null) {
            return out;
        }
        var sample = iter.next();
        while (sample != null && out.size() < 120) {
            if (sample.data != null && sample.when != null) {
                out.add([sample.when.value(), (sample.data as Number).toNumber()]);
            }
            sample = iter.next();
        }
        return out;
    }
}
