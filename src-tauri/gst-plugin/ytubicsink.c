/*
 * GStreamer plugin that keeps WebKitGTK's WebAudio output from going silent
 * on high-latency sinks such as Bluetooth headphones.
 *
 * WebKit plays an AudioContext through its own pipeline: 128-frame buffers
 * from a live source into a pulsesink that is slaved to the system clock.
 * With pulsesink's default 200 ms ring buffer, a sink that reports ~190 ms
 * of latency (SBC on Sony WH-1000XM4) leaves no room, and every sample is
 * written where the server has already read: the stream plays pure
 * silence. A larger buffer-time fixes it (300 ms was enough there; 500 ms
 * leaves room for slower codecs).
 *
 * WebKit offers no way to set that property, so this registers a subclass
 * of pulsesink ranked just above it, which autoaudiosink then picks. The
 * subclass only raises buffer-time for streams WebKit tags with
 * media.role=webaudio; <audio> playback keeps pulsesink's defaults.
 *
 * The app adds this plugin's directory to GST_PLUGIN_PATH at startup.
 */

#define _GNU_SOURCE
/* GST_PLUGIN_DEFINE reads this as the plugin's source module. */
#define PACKAGE "ytubic"

#include <dlfcn.h>
#include <gst/gst.h>

/* Microseconds, the unit of GstAudioBaseSink:buffer-time. */
#define WEBAUDIO_MIN_BUFFER_TIME G_GINT64_CONSTANT (500000)

static gboolean
is_webaudio (GObject * sink)
{
  GstStructure *props = NULL;
  gboolean result = FALSE;

  g_object_get (sink, "stream-properties", &props, NULL);
  if (props) {
    const gchar *role = gst_structure_get_string (props, "media.role");
    result = role != NULL && g_str_equal (role, "webaudio");
    gst_structure_free (props);
  }
  return result;
}

/* Runs whenever stream-properties or buffer-time change. WebKit sets the
 * role when autoaudiosink adds this element, before the ring buffer is
 * acquired, so buffer-time is in place by the time it is read. */
static void
on_notify (GObject * sink, GParamSpec * pspec, gpointer user_data)
{
  gint64 buffer_time = 0;

  if (!is_webaudio (sink))
    return;
  g_object_get (sink, "buffer-time", &buffer_time, NULL);
  if (buffer_time < WEBAUDIO_MIN_BUFFER_TIME)
    g_object_set (sink, "buffer-time", WEBAUDIO_MIN_BUFFER_TIME, NULL);
}

static void
ytubic_sink_init (GTypeInstance * instance, gpointer g_class)
{
  g_signal_connect (instance, "notify::stream-properties",
      G_CALLBACK (on_notify), NULL);
  g_signal_connect (instance, "notify::buffer-time",
      G_CALLBACK (on_notify), NULL);
}

static void
ytubic_sink_class_init (gpointer g_class, gpointer class_data)
{
  gst_element_class_set_static_metadata (GST_ELEMENT_CLASS (g_class),
      "YTubic PulseAudio sink", "Sink/Audio",
      "pulsesink with a larger buffer for WebAudio streams", "YTubic");
}

/* Directories on GST_PLUGIN_PATH are scanned before the system ones, so
 * the first time this plugin is registered pulsesink may not be known yet.
 * Load it from the plugin directory next to libgstreamer itself. */
static GstElementFactory *
find_pulsesink (void)
{
  GstElementFactory *factory = gst_element_factory_find ("pulsesink");
  Dl_info info;

  if (factory)
    return factory;
  if (dladdr ((void *) gst_init, &info) && info.dli_fname) {
    gchar *libdir = g_path_get_dirname (info.dli_fname);
    gchar *path = g_build_filename (libdir, "gstreamer-1.0",
        "libgstpulseaudio.so", NULL);
    GstPlugin *plugin = gst_plugin_load_file (path, NULL);

    if (plugin)
      gst_object_unref (plugin);
    g_free (path);
    g_free (libdir);
  }
  return gst_element_factory_find ("pulsesink");
}

static gboolean
plugin_init (GstPlugin * plugin)
{
  GstElementFactory *factory;
  GstPluginFeature *loaded;
  GType parent, type;
  GTypeQuery query;

  /* Without pulsesink there is nothing to fix; register nothing. */
  factory = find_pulsesink ();
  if (!factory)
    return TRUE;
  loaded = gst_plugin_feature_load (GST_PLUGIN_FEATURE (factory));
  gst_object_unref (factory);
  if (!loaded)
    return TRUE;
  parent = gst_element_factory_get_element_type (GST_ELEMENT_FACTORY (loaded));
  gst_object_unref (loaded);
  if (!parent)
    return TRUE;

  type = g_type_from_name ("YtubicPulseSink");
  if (!type) {
    GTypeInfo info = { 0 };

    g_type_query (parent, &query);
    info.class_size = query.class_size;
    info.class_init = ytubic_sink_class_init;
    info.instance_size = query.instance_size;
    info.instance_init = ytubic_sink_init;
    type = g_type_register_static (parent, "YtubicPulseSink", &info, 0);
  }

  /* pulsesink is PRIMARY + 10. */
  return gst_element_register (plugin, "ytubicpulsesink",
      GST_RANK_PRIMARY + 20, type);
}

GST_PLUGIN_DEFINE (GST_VERSION_MAJOR, GST_VERSION_MINOR, ytubicsink,
    "Keeps WebKitGTK WebAudio audible on high-latency sinks",
    plugin_init, "1.0", "GPL", "YTubic",
    "https://github.com/ameenalasady/YTubic")
