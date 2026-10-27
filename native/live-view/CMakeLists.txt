# AE MCP Live View. Needs the After Effects SDK, which Adobe does not allow us to ship:
#   cmake -S . -B build -DAE_SDK_DIR=/path/to/AfterEffectsSDK/Examples
#   cmake --build build --config Release
cmake_minimum_required(VERSION 3.20)
set(LV_VERSION 0.2.1)
set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64" CACHE STRING "")
set(CMAKE_OSX_DEPLOYMENT_TARGET 11.0 CACHE STRING "")
project(AEMCPLiveView VERSION ${LV_VERSION} LANGUAGES CXX)

set(AE_SDK_DIR "" CACHE PATH "After Effects SDK 'Examples' folder (contains Headers/ and Util/)")
if(NOT EXISTS "${AE_SDK_DIR}/Headers/AE_GeneralPlug.h")
  message(FATAL_ERROR "Set AE_SDK_DIR to the SDK's Examples folder (Headers/AE_GeneralPlug.h not found in '${AE_SDK_DIR}')")
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(LV_NAME "AE MCP Live View")

set(LV_SOURCES
  src/LiveView.cpp
  "${AE_SDK_DIR}/Util/AEGP_SuiteHandler.cpp")

set(LV_INCLUDES
  "${AE_SDK_DIR}/Headers"
  "${AE_SDK_DIR}/Headers/SP"
  "${AE_SDK_DIR}/Headers/adobesdk"
  "${AE_SDK_DIR}/Util"
  "${CMAKE_CURRENT_SOURCE_DIR}/third_party")

if(APPLE)
  add_library(liveview MODULE ${LV_SOURCES})
  target_include_directories(liveview PRIVATE ${LV_INCLUDES} "${AE_SDK_DIR}/Resources")
  configure_file(Info.plist.in "${CMAKE_CURRENT_BINARY_DIR}/Info.plist" @ONLY)
  file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/PkgInfo" "AEgxFXTC")
  set_target_properties(liveview PROPERTIES
    BUNDLE TRUE
    BUNDLE_EXTENSION plugin
    OUTPUT_NAME "${LV_NAME}"
    MACOSX_BUNDLE_INFO_PLIST "${CMAKE_CURRENT_BINARY_DIR}/Info.plist"
    CXX_VISIBILITY_PRESET hidden)
  target_link_libraries(liveview PRIVATE "-framework CoreFoundation")

  # Compile the PiPL with Rez into Contents/Resources/<name>.rsrc, one pass per architecture.
  set(LV_RSRC "${CMAKE_CURRENT_BINARY_DIR}/${LV_NAME}.rsrc")
  add_custom_command(
    OUTPUT "${LV_RSRC}"
    COMMAND xcrun Rez -useDF -d AE_OS_MAC -d AE_OS_MAC_ARM64=1
            -i "${AE_SDK_DIR}/Headers" -i "${AE_SDK_DIR}/Resources" -i "${AE_SDK_DIR}/Util"
            -o "${LV_RSRC}" "${CMAKE_CURRENT_SOURCE_DIR}/src/LiveViewPiPL.r"
    DEPENDS src/LiveViewPiPL.r
    COMMENT "Rez PiPL")
  add_custom_target(pipl DEPENDS "${LV_RSRC}")
  add_dependencies(liveview pipl)
  add_custom_command(TARGET liveview POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "$<TARGET_BUNDLE_CONTENT_DIR:liveview>/Resources"
    COMMAND ${CMAKE_COMMAND} -E copy "${LV_RSRC}" "$<TARGET_BUNDLE_CONTENT_DIR:liveview>/Resources/"
    COMMAND ${CMAKE_COMMAND} -E copy "${CMAKE_CURRENT_BINARY_DIR}/PkgInfo" "$<TARGET_BUNDLE_CONTENT_DIR:liveview>/PkgInfo"
    COMMAND codesign --force --sign - "$<TARGET_BUNDLE_DIR:liveview>")
elseif(WIN32)
  # PiPLtool turns the .r into a .rc that the resource compiler links in.
  set(LV_RR "${CMAKE_CURRENT_BINARY_DIR}/LiveViewPiPL.rr")
  set(LV_RC "${CMAKE_CURRENT_BINARY_DIR}/LiveViewPiPL.rc")
  add_custom_command(
    OUTPUT "${LV_RC}"
    COMMAND cl /nologo /I "${AE_SDK_DIR}/Headers" /I "${AE_SDK_DIR}/Resources" /D AE_OS_WIN /EP "${CMAKE_CURRENT_SOURCE_DIR}/src/LiveViewPiPL.r" > "${LV_RR}"
    COMMAND "${AE_SDK_DIR}/Resources/PiPLtool.exe" "${LV_RR}" "${LV_RC}"
    DEPENDS src/LiveViewPiPL.r
    COMMENT "PiPLtool")
  add_library(liveview MODULE ${LV_SOURCES} "${LV_RC}")
  target_include_directories(liveview PRIVATE ${LV_INCLUDES})
  target_compile_definitions(liveview PRIVATE AE_OS_WIN MSWindows WIN32 _WINDOWS)
  set_target_properties(liveview PROPERTIES OUTPUT_NAME "${LV_NAME}" SUFFIX ".aex")
endif()
